from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from sqlalchemy.orm import Session, sessionmaker
from starlette.staticfiles import StaticFiles

from app.api import api_router
from app.core.errors import register_error_handlers
from app.core.config import PROJECT_ROOT, load_settings
from app.db.session import SessionLocal
from app.services.managed_storage import ManagedStorage


logger = logging.getLogger(__name__)


def _application_lifespan(
    storage: ManagedStorage,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        failed = storage.cleanup_pending_patient_deletes()
        if failed > 0:
            logger.warning(
                "%d pending patient deletion item(s) could not be cleaned; "
                "cleanup will be retried on the next application start",
                failed,
            )
        failed_imports = storage.cleanup_pending_imports()
        if failed_imports > 0:
            logger.warning(
                "%d pending import session(s) could not be cleaned; "
                "cleanup will be retried on the next application start",
                failed_imports,
            )
        yield

    return lifespan


def _configure_contract_openapi(application: FastAPI) -> None:
    def contract_openapi() -> dict:
        if application.openapi_schema is not None:
            return application.openapi_schema

        schema = get_openapi(
            title=application.title,
            version=application.version,
            description=application.description,
            routes=application.routes,
            tags=[
                {
                    "name": "Patients",
                    "description": "Local patient CRUD and search",
                },
                {
                    "name": "DICOM Import",
                    "description": "Local CT DICOM import and reporting",
                },
                {
                    "name": "Studies",
                    "description": "Local Study, Series, and Instance metadata",
                },
                {
                    "name": "Instances",
                    "description": "Read-only local managed DICOM resources",
                },
            ],
        )
        schema["servers"] = [
            {
                "url": "http://127.0.0.1:8000",
                "description": "Local FastAPI service",
            }
        ]
        schema["security"] = []

        components = schema.setdefault("components", {})
        schemas = components.setdefault("schemas", {})
        for schema_name in ("ErrorResponse", "ErrorDetail", "FieldError"):
            schemas[schema_name].pop("title", None)

        schemas["ErrorDetail"]["properties"]["code"]["enum"] = [
            "validation_error",
            "medical_record_no_conflict",
            "patient_not_found",
            "study_not_found",
            "series_not_found",
            "instance_not_found",
            "series_not_viewable",
            "dicom_file_missing",
            "import_limit_exceeded",
            "persistence_error",
        ]
        schemas["FieldError"]["properties"]["field"]["enum"] = [
            "medical_record_no",
            "name",
            "sex",
            "birth_date",
            "id",
            "patient_id",
            "study_id",
            "series_id",
            "instance_id",
            "files",
            "request",
        ]

        components["parameters"] = {
            "PatientId": {
                "name": "id",
                "in": "path",
                "required": True,
                "description": "Internal patient UUID used only for API resource identity",
                "schema": {"type": "string", "format": "uuid"},
            },
            "PatientResourceId": {
                "name": "patient_id",
                "in": "path",
                "required": True,
                "description": "Internal patient UUID used only for API resource identity",
                "schema": {"type": "string", "format": "uuid"},
            },
            "StudyId": {
                "name": "study_id",
                "in": "path",
                "required": True,
                "description": "Internal study UUID used only for API resource identity",
                "schema": {"type": "string", "format": "uuid"},
            },
            "SeriesId": {
                "name": "series_id",
                "in": "path",
                "required": True,
                "description": "Internal series UUID used only for API resource identity",
                "schema": {"type": "string", "format": "uuid"},
            },
            "InstanceId": {
                "name": "instance_id",
                "in": "path",
                "required": True,
                "description": "Internal instance UUID used only for API resource identity",
                "schema": {"type": "string", "format": "uuid"},
            },
        }
        error_schema = {"$ref": "#/components/schemas/ErrorResponse"}
        no_store_header = {
            "Cache-Control": {
                "description": "Prevents reuse of stale local DICOM resource state",
                "schema": {"type": "string", "const": "no-store"},
            }
        }
        components["responses"] = {
            "ValidationError": {
                "description": "Request or field validation failed",
                "content": {"application/json": {"schema": error_schema}},
            },
            "MedicalRecordNumberConflict": {
                "description": "The normalized medical record number already exists",
                "content": {"application/json": {"schema": error_schema}},
            },
            "PatientNotFound": {
                "description": "Patient does not exist",
                "content": {"application/json": {"schema": error_schema}},
            },
            "StudyNotFound": {
                "description": "Study does not exist",
                "content": {"application/json": {"schema": error_schema}},
            },
            "SeriesNotFound": {
                "description": "Series does not exist",
                "content": {"application/json": {"schema": error_schema}},
            },
            "InstanceNotFound": {
                "description": "Instance does not exist",
                "content": {"application/json": {"schema": error_schema}},
            },
            "SeriesNotViewable": {
                "description": "The instance belongs to a series that is not viewable",
                "content": {"application/json": {"schema": error_schema}},
            },
            "DicomFileMissing": {
                "description": "The indexed managed DICOM file no longer exists",
                "headers": no_store_header,
                "content": {"application/json": {"schema": error_schema}},
            },
            "PersistenceError": {
                "description": "Local persistence failed",
                "content": {"application/json": {"schema": error_schema}},
            },
            "ImportLimitExceeded": {
                "description": "The import exceeds the local teaching limits",
                "content": {"application/json": {"schema": error_schema}},
            },
        }

        paths = schema["paths"]
        list_operation = paths["/api/patients"]["get"]
        list_operation["responses"]["200"]["content"]["application/json"][
            "schema"
        ].pop("title", None)
        list_operation["responses"] = {
            "200": list_operation["responses"]["200"],
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        create_operation = paths["/api/patients"]["post"]
        create_operation["responses"] = {
            "201": create_operation["responses"]["201"],
            "409": {
                "$ref": "#/components/responses/MedicalRecordNumberConflict"
            },
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        patient_path = paths["/api/patients/{id}"]
        patient_path["parameters"] = [
            {"$ref": "#/components/parameters/PatientId"}
        ]
        detail_operation = patient_path["get"]
        detail_operation.pop("parameters", None)
        detail_operation["responses"] = {
            "200": detail_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/PatientNotFound"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        patch_operation = patient_path["patch"]
        patch_operation.pop("parameters", None)
        patch_operation["responses"] = {
            "200": patch_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/PatientNotFound"},
            "409": {
                "$ref": "#/components/responses/MedicalRecordNumberConflict"
            },
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        delete_operation = patient_path["delete"]
        delete_operation.pop("parameters", None)
        delete_operation["responses"] = {
            "204": {
                "description": "Patient permanently deleted; no response body"
            },
            "404": {"$ref": "#/components/responses/PatientNotFound"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        import_path = paths["/api/patients/{patient_id}/dicom-import"]
        import_path["parameters"] = [
            {"$ref": "#/components/parameters/PatientResourceId"}
        ]
        import_operation = import_path["post"]
        import_operation.pop("parameters", None)
        import_operation["responses"] = {
            "200": import_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/PatientNotFound"},
            "413": {"$ref": "#/components/responses/ImportLimitExceeded"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        studies_path = paths["/api/patients/{patient_id}/studies"]
        studies_path["parameters"] = [
            {"$ref": "#/components/parameters/PatientResourceId"}
        ]
        studies_operation = studies_path["get"]
        studies_operation.pop("parameters", None)
        studies_operation["responses"] = {
            "200": studies_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/PatientNotFound"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        study_series_path = paths["/api/studies/{study_id}/series"]
        study_series_path["parameters"] = [
            {"$ref": "#/components/parameters/StudyId"}
        ]
        study_series_operation = study_series_path["get"]
        study_series_operation.pop("parameters", None)
        study_series_operation["responses"] = {
            "200": study_series_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/StudyNotFound"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        series_path = paths["/api/series/{series_id}"]
        series_path["parameters"] = [
            {"$ref": "#/components/parameters/SeriesId"}
        ]
        series_operation = series_path["get"]
        series_operation.pop("parameters", None)
        series_operation["responses"] = {
            "200": series_operation["responses"]["200"],
            "404": {"$ref": "#/components/responses/SeriesNotFound"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        instance_path = paths["/api/instances/{instance_id}/file"]
        instance_path["parameters"] = [
            {"$ref": "#/components/parameters/InstanceId"}
        ]
        instance_operation = instance_path["get"]
        instance_operation.pop("parameters", None)
        instance_operation["responses"] = {
            "200": {
                "description": "Managed DICOM Part 10 file",
                "headers": no_store_header,
                "content": {
                    "application/dicom": {
                        "schema": {"type": "string", "format": "binary"}
                    }
                },
            },
            "404": {"$ref": "#/components/responses/InstanceNotFound"},
            "409": {"$ref": "#/components/responses/SeriesNotViewable"},
            "410": {"$ref": "#/components/responses/DicomFileMissing"},
            "422": {"$ref": "#/components/responses/ValidationError"},
            "500": {"$ref": "#/components/responses/PersistenceError"},
        }

        application.openapi_schema = schema
        return schema

    application.openapi = contract_openapi


def create_app(
    *,
    session_factory: sessionmaker[Session] | None = None,
    managed_storage: ManagedStorage | None = None,
    frontend_dist_override: Path | None = None,
) -> FastAPI:
    configured_storage = managed_storage or ManagedStorage(load_settings())
    application = FastAPI(
        title="Local CT Imaging Lab API",
        version="0.3.0",
        description=(
            "Local-only API for Local CT Imaging Lab, an educational medical CT application. "
            "Not for clinical diagnosis."
        ),
        lifespan=_application_lifespan(configured_storage),
    )
    application.state.session_factory = session_factory or SessionLocal
    application.state.managed_storage = configured_storage
    register_error_handlers(application)
    application.include_router(api_router, prefix="/api")
    _configure_contract_openapi(application)
    frontend_dist = frontend_dist_override or PROJECT_ROOT / "frontend" / "dist"
    if (frontend_dist / "index.html").is_file():
        application.mount(
            "/",
            StaticFiles(directory=frontend_dist, html=True),
            name="frontend",
        )
    return application


app = create_app()
