from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = (
    REPOSITORY_ROOT
    / "specs"
    / "002-dicom-import"
    / "contracts"
    / "openapi.yaml"
)


def _runtime_openapi(application: FastAPI) -> dict[str, Any]:
    return application.openapi()


def _design_operation(path: str, method: str) -> str:
    lines = CONTRACT_PATH.read_text(encoding="utf-8").splitlines()
    path_start = lines.index(f"  {path}:")
    path_end = next(
        (
            index
            for index in range(path_start + 1, len(lines))
            if lines[index].startswith("  /")
        ),
        len(lines),
    )
    method_start = lines.index(f"    {method}:", path_start, path_end)
    method_end = next(
        (
            index
            for index in range(method_start + 1, path_end)
            if lines[index].startswith("    ")
            and not lines[index].startswith("      ")
        ),
        path_end,
    )
    return "\n".join(lines[method_start:method_end])


def test_design_contract_declares_local_patient_api_and_public_schemas() -> None:
    contract = CONTRACT_PATH.read_text(encoding="utf-8")

    for required_fragment in (
        "openapi: 3.1.0",
        "url: http://127.0.0.1:8000",
        "/api/patients:",
        "/api/patients/{id}:",
        "/api/patients/{patient_id}/dicom-import:",
        "/api/patients/{patient_id}/studies:",
        "/api/studies/{study_id}/series:",
        "/api/series/{series_id}:",
        "PatientCreate:",
        "PatientPatch:",
        "PatientRead:",
        "ImportReport:",
        "StudyRead:",
        "SeriesRead:",
        "SeriesDetailRead:",
        "ErrorResponse:",
        "PersistenceError:",
        "ImportLimitExceeded:",
        '"201":',
        '"409":',
        '"413":',
        '"422":',
        '"500":',
    ):
        assert required_fragment in contract
    assert "medical_record_no_normalized:" not in contract
    assert "name: q" in contract
    assert "patch:" in contract


def test_design_contract_scopes_413_to_dicom_import() -> None:
    patient_detail = _design_operation("/api/patients/{id}", "get")
    dicom_import = _design_operation(
        "/api/patients/{patient_id}/dicom-import",
        "post",
    )

    assert '"413":' not in patient_detail
    assert '"413":' in dicom_import
    assert "#/components/responses/ImportLimitExceeded" in dicom_import
    assert "maxItems: 2000" in dicom_import


def test_runtime_patient_schemas_match_public_contract(application: FastAPI) -> None:
    schemas = _runtime_openapi(application)["components"]["schemas"]

    patient_create = schemas["PatientCreate"]
    assert patient_create["additionalProperties"] is False
    assert set(patient_create["required"]) == {"medical_record_no", "name"}
    assert set(patient_create["properties"]) == {
        "medical_record_no",
        "name",
        "sex",
        "birth_date",
    }

    patient_patch = schemas["PatientPatch"]
    assert patient_patch["additionalProperties"] is False
    assert patient_patch["minProperties"] == 1
    assert set(patient_patch["properties"]) == {
        "medical_record_no",
        "name",
        "sex",
        "birth_date",
    }

    patient_read = schemas["PatientRead"]
    expected_read_fields = {
        "id",
        "medical_record_no",
        "name",
        "sex",
        "birth_date",
        "study_count",
        "latest_study_date",
        "created_at",
        "updated_at",
    }
    assert set(patient_read["required"]) == expected_read_fields
    assert set(patient_read["properties"]) == expected_read_fields
    assert "medical_record_no_normalized" not in patient_read["properties"]
    assert patient_read["properties"]["study_count"]["minimum"] == 0
    assert patient_read["properties"]["latest_study_date"]["anyOf"] == [
        {"type": "string", "format": "date"},
        {"type": "null"},
    ]


def test_runtime_dicom_import_and_study_contracts(application: FastAPI) -> None:
    openapi = _runtime_openapi(application)
    paths = openapi["paths"]
    schemas = openapi["components"]["schemas"]

    request_schema_ref = paths["/api/patients/{patient_id}/dicom-import"][
        "post"
    ]["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    request_schema = schemas[request_schema_ref.rsplit("/", 1)[-1]]
    assert request_schema["properties"]["files"]["maxItems"] == 2_000

    assert paths["/api/patients/{patient_id}/dicom-import"]["post"][
        "operationId"
    ] == "importPatientDicom"
    assert set(
        paths["/api/patients/{patient_id}/dicom-import"]["post"]["responses"]
    ) == {"200", "404", "413", "422", "500"}
    assert paths["/api/patients/{patient_id}/dicom-import"]["post"]["responses"][
        "413"
    ] == {"$ref": "#/components/responses/ImportLimitExceeded"}
    assert paths["/api/patients/{patient_id}/studies"]["get"][
        "operationId"
    ] == "listPatientStudies"
    assert paths["/api/studies/{study_id}/series"]["get"][
        "operationId"
    ] == "listStudySeries"
    assert paths["/api/series/{series_id}"]["get"]["operationId"] == (
        "getSeriesDetails"
    )
    assert set(schemas["ImportReport"]["required"]) == {
        "total",
        "success",
        "duplicate",
        "skipped",
        "unsupported",
        "failed",
        "items",
    }
    assert set(schemas["StudyRead"]["properties"]) == {
        "id",
        "study_instance_uid",
        "dicom_patient_id",
        "study_date",
        "study_time",
        "accession_number",
        "description",
        "series_count",
        "instance_count",
        "created_at",
    }
    assert "managed_path" not in str(schemas)


def test_runtime_instance_file_contract(application: FastAPI) -> None:
    openapi = _runtime_openapi(application)
    path_item = openapi["paths"]["/api/instances/{instance_id}/file"]
    operation = path_item["get"]

    assert path_item["parameters"] == [
        {"$ref": "#/components/parameters/InstanceId"}
    ]
    assert operation["operationId"] == "getInstanceDicomFile"
    assert set(operation["responses"]) == {"200", "404", "409", "410", "422", "500"}
    assert operation["responses"]["200"]["content"] == {
        "application/dicom": {"schema": {"type": "string", "format": "binary"}}
    }
    assert operation["responses"]["200"]["headers"]["Cache-Control"]["schema"] == {
        "type": "string",
        "const": "no-store",
    }
    assert operation["responses"]["404"] == {
        "$ref": "#/components/responses/InstanceNotFound"
    }
    assert operation["responses"]["409"] == {
        "$ref": "#/components/responses/SeriesNotViewable"
    }
    assert operation["responses"]["410"] == {
        "$ref": "#/components/responses/DicomFileMissing"
    }
    assert openapi["components"]["responses"]["DicomFileMissing"]["headers"][
        "Cache-Control"
    ]["schema"] == {"type": "string", "const": "no-store"}
    assert {
        "instance_not_found",
        "series_not_viewable",
        "dicom_file_missing",
    }.issubset(
        set(openapi["components"]["schemas"]["ErrorDetail"]["properties"]["code"]["enum"])
    )


def test_runtime_error_schemas_match_unified_contract(application: FastAPI) -> None:
    schemas = _runtime_openapi(application)["components"]["schemas"]

    assert schemas["ErrorResponse"] == {
        "type": "object",
        "additionalProperties": False,
        "required": ["error"],
        "properties": {"error": {"$ref": "#/components/schemas/ErrorDetail"}},
    }
    assert set(schemas["ErrorDetail"]["required"]) == {
        "code",
        "message",
        "field_errors",
    }
    assert set(schemas["ErrorDetail"]["properties"]) == {
        "code",
        "message",
        "field_errors",
    }
    assert set(schemas["FieldError"]["required"]) == {"field", "code", "message"}
    assert set(schemas["FieldError"]["properties"]) == {
        "field",
        "code",
        "message",
    }


def test_runtime_get_patient_list_contract(application: FastAPI) -> None:
    operation = _runtime_openapi(application)["paths"]["/api/patients"]["get"]

    assert operation["operationId"] == "listPatients"
    assert set(operation["responses"]) == {"200", "500"}
    assert operation["parameters"] == [
        {
            "name": "q",
            "in": "query",
            "required": False,
            "schema": {"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Q"},
        }
    ]
    response_schema = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert response_schema == {
        "type": "array",
        "items": {"$ref": "#/components/schemas/PatientRead"},
    }


def test_runtime_post_patient_contract(application: FastAPI) -> None:
    operation = _runtime_openapi(application)["paths"]["/api/patients"]["post"]

    assert operation["operationId"] == "createPatient"
    assert operation["requestBody"]["required"] is True
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema == {"$ref": "#/components/schemas/PatientCreate"}
    assert set(operation["responses"]) == {"201", "409", "422", "500"}
    created = operation["responses"]["201"]
    assert created["headers"]["Location"]["schema"]["type"] == "string"
    assert created["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PatientRead"
    }


def test_runtime_get_patient_details_contract(application: FastAPI) -> None:
    path_item = _runtime_openapi(application)["paths"]["/api/patients/{id}"]
    operation = path_item["get"]

    assert path_item["parameters"] == [
        {"$ref": "#/components/parameters/PatientId"}
    ]
    assert operation["operationId"] == "getPatient"
    assert set(operation["responses"]) == {"200", "404", "422", "500"}
    assert operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/PatientRead"}


def test_runtime_patch_patient_contract(application: FastAPI) -> None:
    operation = _runtime_openapi(application)["paths"]["/api/patients/{id}"][
        "patch"
    ]

    assert operation["operationId"] == "updatePatient"
    assert operation["requestBody"]["required"] is True
    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PatientPatch"
    }
    assert set(operation["responses"]) == {"200", "404", "409", "422", "500"}
    assert operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/PatientRead"}


def test_runtime_delete_patient_contract(application: FastAPI) -> None:
    operation = _runtime_openapi(application)["paths"]["/api/patients/{id}"][
        "delete"
    ]

    assert operation["operationId"] == "deletePatient"
    assert set(operation["responses"]) == {"204", "404", "409", "422", "500"}
    assert operation["responses"]["409"] == {
        "$ref": "#/components/responses/ImportInProgress"
    }
    assert operation["responses"]["204"] == {
        "description": "Patient permanently deleted; no response body"
    }


def test_runtime_patch_persistence_failure_is_sanitized(
    client: TestClient,
    monkeypatch: Any,
) -> None:
    created = client.post(
        "/api/patients",
        json={"medical_record_no": "MR-CONTRACT", "name": "Contract Patient"},
    ).json()

    def fail_commit(_session: Session) -> None:
        raise SQLAlchemyError(r"sqlite D:\private\patient.sqlite3 secret")

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.patch(
        f"/api/patients/{created['id']}",
        json={"name": "Updated"},
    )

    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "persistence_error",
            "message": "无法保存本次操作，请重试",
            "field_errors": [],
        }
    }
    assert "sqlite" not in response.text.lower()
    assert "private" not in response.text.lower()


def test_runtime_error_responses_reference_contract_components(
    application: FastAPI,
) -> None:
    paths = _runtime_openapi(application)["paths"]
    expected_references = {
        ("/api/patients", "get", "500"): "PersistenceError",
        ("/api/patients", "post", "409"): "MedicalRecordNumberConflict",
        ("/api/patients", "post", "422"): "ValidationError",
        ("/api/patients", "post", "500"): "PersistenceError",
        ("/api/patients/{id}", "get", "404"): "PatientNotFound",
        ("/api/patients/{id}", "get", "422"): "ValidationError",
        ("/api/patients/{id}", "get", "500"): "PersistenceError",
        ("/api/patients/{id}", "patch", "404"): "PatientNotFound",
        ("/api/patients/{id}", "patch", "409"): "MedicalRecordNumberConflict",
        ("/api/patients/{id}", "patch", "422"): "ValidationError",
        ("/api/patients/{id}", "patch", "500"): "PersistenceError",
        ("/api/patients/{id}", "delete", "404"): "PatientNotFound",
        ("/api/patients/{id}", "delete", "422"): "ValidationError",
        ("/api/patients/{id}", "delete", "500"): "PersistenceError",
    }

    for (path, method, status), component_name in expected_references.items():
        assert paths[path][method]["responses"][status] == {
            "$ref": f"#/components/responses/{component_name}"
        }


def test_runtime_viewer_state_contract(application: FastAPI) -> None:
    openapi = _runtime_openapi(application)
    path_item = openapi["paths"]["/api/series/{series_id}/viewer-state"]

    assert path_item["parameters"] == [
        {"$ref": "#/components/parameters/SeriesId"}
    ]
    expected = {
        "get": ("getViewerState", {"200", "404", "422", "500"}),
        "put": ("putViewerState", {"200", "404", "422", "500"}),
        "delete": ("deleteViewerState", {"204", "404", "422", "500"}),
    }
    for method, (operation_id, responses) in expected.items():
        operation = path_item[method]
        assert operation["operationId"] == operation_id
        assert set(operation["responses"]) == responses

    schemas = openapi["components"]["schemas"]
    assert schemas["ViewerStateWrite"]["additionalProperties"] is False
    assert set(schemas["ViewerStateWrite"]["required"]) == {
        "schema_version",
        "state",
    }
    assert schemas["ViewerStateWrite"]["properties"]["schema_version"]["const"] == 1
    assert schemas["ViewerStatePayload"]["properties"]["annotations"]["maxItems"] == 500
    assert "referenced_image_id" in schemas["PersistedAnnotation"]["required"]
    assert schemas["PersistedAnnotation"]["properties"]["referenced_image_id"][
        "maxLength"
    ] == 2048


def test_runtime_import_job_contract(application: FastAPI) -> None:
    openapi = _runtime_openapi(application)
    paths = openapi["paths"]
    schemas = openapi["components"]["schemas"]
    assert {
        "/api/patients/{patient_id}/import-jobs",
        "/api/patients/{patient_id}/import-jobs/latest",
        "/api/import-jobs/{job_id}",
        "/api/import-jobs/{job_id}/files/{file_id}/content",
        "/api/import-jobs/{job_id}/queue",
    }.issubset(paths)
    assert paths["/api/patients/{patient_id}/import-jobs"]["post"][
        "operationId"
    ] == "createImportJob"
    upload = paths["/api/import-jobs/{job_id}/files/{file_id}/content"]["put"]
    assert upload["requestBody"]["content"]["application/octet-stream"]["schema"] == {
        "type": "string",
        "format": "binary",
    }
    assert "ImportJobRead" in schemas
    assert "ImportUploadProgressRead" in schemas
    error_codes = set(schemas["ErrorDetail"]["properties"]["code"]["enum"])
    assert {
        "import_job_not_found",
        "import_job_conflict",
        "import_job_state_conflict",
        "import_offset_conflict",
        "import_file_mismatch",
        "import_in_progress",
    }.issubset(error_codes)
