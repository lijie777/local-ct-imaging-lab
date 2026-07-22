# Data Model: DICOM 导入与持久化

## Overview

本 Feature 在现有 `Patient` 下增加 `Study → Series → Instance` 层级。SQLite 保存结构化元数据和
相对受管路径；像素数据只存在于本机 `.dcm` 文件。所有 UUID 仅用于内部 API 资源身份，不在用户
界面直接显示。

```text
Patient 1 ── * Study 1 ── * Series 1 ── * Instance 1 ── 1 Managed DICOM File
```

## Patient changes

现有 Patient 字段不变。新增一对多关系 `studies`，删除 Patient 时级联删除全部 Study、Series 和
Instance。公共摘要从数据库派生：

- `study_count`: 当前 Study 数量，没有检查时为 0。
- `latest_study_date`: 非空 Study 日期的最大值；全部为空时为 null。

不向 patients 表增加冗余汇总列。

## Study

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | UUID | Yes | Internal primary key |
| `patient_id` | UUID | Yes | FK → patients.id, ON DELETE CASCADE |
| `study_instance_uid` | string(64) | Yes | Valid DICOM UID, globally unique |
| `dicom_patient_id` | string(64) | Yes | Trimmed source PatientID; normalized form must match Patient MRN |
| `study_date` | date | No | Parsed DICOM DA |
| `study_time` | time | No | Parsed DICOM TM without inventing timezone |
| `accession_number` | string(64) | No | Trimmed, no control characters |
| `description` | string(256) | No | Trimmed, no control characters |
| `created_at` | datetime | Yes | UTC storage time |
| `updated_at` | datetime | Yes | UTC storage time; created_at <= updated_at |

Indexes:

- unique `study_instance_uid`
- list index `(patient_id, study_date DESC, created_at DESC, study_instance_uid ASC)`

## Series

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | UUID | Yes | Internal primary key |
| `study_id` | UUID | Yes | FK → studies.id, ON DELETE CASCADE |
| `series_instance_uid` | string(64) | Yes | Valid DICOM UID, globally unique |
| `modality` | string(16) | Yes | Persisted data in this Feature is `CT` |
| `series_number` | integer | No | Parsed when the value is a valid integer |
| `description` | string(256) | No | Trimmed, no control characters |
| `body_part_examined` | string(64) | No | Trimmed, no control characters |
| `rows` | integer | No | Positive when present |
| `columns` | integer | No | Positive when present |
| `viewability_status` | enum string | Yes | `eligible` or `unsupported` |
| `viewability_reason` | string(64) | No | Stable reason code; required for unsupported |
| `created_at` | datetime | Yes | UTC storage time |
| `updated_at` | datetime | Yes | UTC storage time |

Constraints:

- unique `series_instance_uid`
- `viewability_status IN ('eligible', 'unsupported')`
- eligible requires null `viewability_reason`; unsupported requires non-null reason
- stable list index `(study_id, series_number ASC, series_instance_uid ASC)`

If instances disagree on Rows, Columns, orientation, transfer support, or required geometry, the Series becomes
unsupported with a deterministic priority reason. The status is recomputed whenever new instances are added.

## Instance

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | UUID | Yes | Internal primary key |
| `series_id` | UUID | Yes | FK → series.id, ON DELETE CASCADE |
| `sop_instance_uid` | string(64) | Yes | Valid DICOM UID, globally unique duplicate key |
| `sop_class_uid` | string(64) | Yes | Valid DICOM UID |
| `transfer_syntax_uid` | string(64) | Yes | Valid DICOM UID |
| `instance_number` | integer | No | Parsed when valid |
| `image_position_patient` | JSON text | No | Exactly 3 finite decimal values when present |
| `image_orientation_patient` | JSON text | No | Exactly 6 finite decimal values when present |
| `rows` | integer | No | Positive when present |
| `columns` | integer | No | Positive when present |
| `managed_path` | string(1024) | Yes | POSIX-style path relative to data_dir; never absolute |
| `file_size` | integer | Yes | Non-negative bytes |
| `created_at` | datetime | Yes | UTC storage time |

Indexes:

- unique `sop_instance_uid`
- stable list index `(series_id, instance_number ASC, sop_instance_uid ASC)`

The public Instance response omits `managed_path` and `file_size` unless a future Feature explicitly requires a
safe resource endpoint. This Feature does not expose raw file paths.

## Import report (non-persistent response model)

### ImportReport

| Field | Type | Rules |
| --- | --- | --- |
| `total` | integer | Number of input files |
| `success` | integer | Newly stored eligible CT files |
| `duplicate` | integer | Existing SOP UID; no mutation |
| `skipped` | integer | Outside accepted scope or patient mismatch |
| `unsupported` | integer | Stored CT with explicit unviewable reason |
| `failed` | integer | Parse, required-tag, storage, or persistence failure |
| `items` | ImportItem[] | Exactly one item per input file, original input order |

Invariant:

```text
total = success + duplicate + skipped + unsupported + failed = len(items)
```

### ImportItem

- `file_name`: client-visible name or relative folder name; never an absolute path.
- `category`: one of the five categories.
- `code`: stable machine-readable reason.
- `message`: localized user-facing reason.
- `study_instance_uid`, `series_instance_uid`, `sop_instance_uid`: optional trace identifiers when safely parsed.

## Category rules

| Input condition | Category | Persistence |
| --- | --- | --- |
| New CT, supported baseline transfer syntax and complete baseline metadata | success | Metadata and file stored |
| SOP UID already exists | duplicate | No change |
| Non-DICOM, non-CT, missing PatientID, PatientID mismatch/group mismatch | skipped | No change |
| CT metadata readable but unsupported transfer syntax or incomplete view geometry | unsupported | Metadata and file stored; Series unsupported |
| Damaged DICOM, missing required UID, temp/storage/database failure | failed | No final new record/file for failed Study unit |

## Lifecycle and transactions

### Import

1. Upload file enters a request-scoped temporary directory.
2. Parser returns a file-level result without ORM state.
3. Candidates are grouped by Study UID.
4. Patient mismatch blocks the Study group before any mutation.
5. Existing SOP UIDs become duplicates.
6. New managed files are tracked in current-operation order.
7. ORM records flush and commit per Study.
8. Failure rolls back and removes only current-operation files for that Study.
9. Temporary request directory is always removed.

### Delete

1. Capture Study/Series/Instance plain-value snapshot.
2. Atomically move `dicom/{patient_uuid}` to delete staging when it exists.
3. Delete Patient; database cascades child indexes.
4. Commit database deletion.
5. Permanently purge staged directory.
6. Commit failure restores directory; purge failure restores database snapshot and directory before returning failure.

## Stable ordering

- Studies: study date descending with null last, then creation time descending, then Study UID ascending.
- Series: series number ascending with null last, then Series UID ascending.
- Instances: 当 Series 全部实例具有有效且一致的 ImageOrientationPatient 与 ImagePositionPatient 时，
  以行/列方向叉积为法向量，按 `dot(position, normal)` 升序；否则按 instance number 升序且 null last；
  final key 始终为 SOP UID 升序。即使元数据不完整，API 也必须返回确定顺序。
