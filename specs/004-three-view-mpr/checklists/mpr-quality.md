# MPR Requirements Quality Checklist: 联动 CT 三视图 MPR

**Purpose**: Validate the completeness, clarity, consistency, measurability, safety, and recovery coverage of the three-view MPR requirements before technical planning
**Created**: 2026-07-20
**Feature**: [spec.md](../spec.md)

**Note**: This checklist evaluates the quality of the written requirements, not the implementation.

## Scope and MPR Eligibility

- [x] CHK001 Are the entry point and return destination for MPR explicitly defined without replacing the axial viewer? [Completeness, Spec §FR-001, §FR-002, §FR-017]
- [x] CHK002 Are the minimum spatial conditions for entering MPR stated in objectively testable terms? [Clarity, Spec §FR-003]
- [x] CHK003 Are single-slice, repeated-position, zero-extent, missing-geometry, inconsistent-dimension, and inconsistent-orientation cases addressed? [Coverage, Spec §Edge Cases, §FR-003]
- [x] CHK004 Is the relationship between persisted Series viewability and session-only MPR eligibility unambiguous? [Consistency, Spec §Key Entities, §Assumptions]
- [x] CHK005 Are excluded diagnostic and connectivity capabilities consistently bounded across constitutional constraints and non-goals? [Consistency, Spec §Constitutional Constraints, §Non-Goals]

## Three-View Spatial Linking

- [x] CHK006 Are the required axial, coronal, and sagittal planes explicitly named and limited to three two-dimensional views? [Completeness, Spec §FR-004, §FR-029]
- [x] CHK007 Is the initial linked position defined as the volume center for all three views? [Clarity, Spec §FR-005]
- [x] CHK008 Are crosshair movement and wheel navigation both covered as sources of linked-position changes? [Coverage, Spec §FR-008, §FR-009]
- [x] CHK009 Is the expected response of both non-active views defined for interaction originating in each plane? [Completeness, Spec §US1 Acceptance Scenarios]
- [x] CHK010 Is “same spatial position” measurable through a shared position representation rather than visual similarity alone? [Measurability, Spec §FR-005, §SC-003]
- [x] CHK011 Are spatial boundary requirements defined for rapid and repeated interaction as well as ordinary interaction? [Edge Case, Spec §FR-010, §Edge Cases]
- [x] CHK012 Are initial display and three-way linking independently testable as the P1 user outcome? [Acceptance Criteria, Spec §US1, §SC-002, §SC-003]

## Tools, Sharing Rules, and Reset

- [x] CHK013 Are all primary tools enumerated and their mutual-exclusion rule explicitly stated? [Completeness, Spec §FR-011, §FR-012]
- [x] CHK014 Is the default tool identified without requiring a planning-stage assumption? [Clarity, Spec §FR-016, §Assumptions]
- [x] CHK015 Is window width/level sharing across all three views distinguished from per-view pan and zoom? [Consistency, Spec §FR-013, §FR-014]
- [x] CHK016 Are crosshair visibility and linked-position persistence rules defined for both hiding and showing? [Completeness, Spec §FR-015, §Edge Cases]
- [x] CHK017 Does the reset requirement enumerate position, cameras, grayscale, crosshair visibility, and active tool? [Clarity, Spec §FR-016]
- [x] CHK018 Is the non-persistence rule complete for position, active view, tools, crosshair, grayscale, pan, and zoom? [Completeness, Spec §FR-018]
- [x] CHK019 Can the five required tool outcomes be objectively observed in the real-browser acceptance criteria? [Measurability, Spec §SC-004]

## View Identification, Metadata, and Privacy

- [x] CHK020 Are the view name, patient direction, current position, and active-state overlays required for every viewport? [Completeness, Spec §FR-006, §FR-007]
- [x] CHK021 Is the active viewport required to use both textual and visual expression, avoiding color-only meaning? [Accessibility, Spec §FR-007]
- [x] CHK022 Are all user-visible metadata fields enumerated, including behavior when slice spacing cannot be derived? [Clarity, Spec §FR-019]
- [x] CHK023 Are forbidden identifiers and sensitive technical details explicitly enumerated for the UI? [Privacy, Spec §FR-020]
- [x] CHK024 Are metadata-panel and overlay requirements consistent with the local teaching purpose and non-diagnostic warning? [Consistency, Spec §US2, §FR-019, §FR-027]

## Failure, Recovery, and Lifecycle

- [x] CHK025 Are MPR eligibility, Series state, missing file, decode/build, local-service, and rendering failures defined as distinguishable categories? [Completeness, Spec §FR-021]
- [x] CHK026 Are retry and return-to-axial actions assigned to the correct recoverable and non-recoverable states? [Clarity, Spec §FR-022, §US3]
- [x] CHK027 Is axial viewing explicitly preserved when MPR is unavailable or fails? [Recovery, Spec §FR-002, §FR-017]
- [x] CHK028 Are no-skip, no-delete, no-overwrite, and no-repair rules defined for all MPR failures? [Data Integrity, Spec §FR-023]
- [x] CHK029 Are cancellation and resource-release requirements complete for unload, return, Series change, retry, and load cancellation? [Lifecycle, Spec §FR-024]
- [x] CHK030 Is loading-before-exit covered with measurable absence of later requests, canvases, state updates, and console errors? [Measurability, Spec §US3 Scenario 5, §SC-007]

## Layout, Accessibility, Safety, and Locality

- [x] CHK031 Is the desktop two-by-two composition fully specified as three viewports plus one metadata panel? [Clarity, Spec §FR-025]
- [x] CHK032 Is narrow-screen behavior defined as complete vertical access rather than an unspecified responsive layout? [Clarity, Spec §FR-025, §SC-008]
- [x] CHK033 Are keyboard-access requirements stated for return, retry, tools, visibility, reset, and all three viewports? [Accessibility, Spec §FR-026]
- [x] CHK034 Are non-color requirements applied consistently to active tool, active viewport, position, and errors? [Accessibility, Spec §FR-007, §FR-012, §FR-026]
- [x] CHK035 Are the major pages and asynchronous states requiring the full non-clinical notice enumerated? [Safety, Spec §Constitutional Constraints, §FR-027]
- [x] CHK036 Is the local-only boundary explicit for metadata, files, volume data, pixels, and network requests? [Privacy, Spec §FR-028]
- [x] CHK037 Are restart persistence requirements limited to previously stored Patient/DICOM data rather than transient viewer state? [Consistency, Spec §SC-006, §SC-009, §Assumptions]

## Acceptance, Performance, and Dependencies

- [x] CHK038 Is the entry-effort target quantified from an already loaded axial view? [Measurability, Spec §SC-001]
- [x] CHK039 Is the three-viewport first-image target quantified with a time limit and real CT precondition? [Performance, Spec §SC-002]
- [x] CHK040 Does the end-to-end path cover primary, alternate, exception, recovery, accessibility, locality, cleanup, and restart scenarios? [Scenario Coverage, Spec §End-to-End Acceptance Path]
- [x] CHK041 Are dependencies on completed Patient, DICOM import, persistence, ordering, file-resource, and axial-viewer capabilities documented? [Dependencies, Spec §Assumptions]
- [x] CHK042 Is completion gated on applicable backend/frontend automation, production build, and a complete real-browser path? [Definition of Done, Spec §SC-010]

## Notes

- Standard-depth reviewer checklist focused on MPR spatial semantics, interaction/UX, safety/privacy, recovery, lifecycle, and measurable acceptance.
- Validation pass 1: all 42 requirements-quality items pass; no gaps require specification changes before planning.
