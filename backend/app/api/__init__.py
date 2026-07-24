from fastapi import APIRouter

from app.api.patients import router as patients_router
from app.api.dicom_import import router as dicom_import_router
from app.api.studies import router as studies_router
from app.api.instances import router as instances_router
from app.api.viewer_states import router as viewer_states_router
from app.api.import_jobs import router as import_jobs_router


api_router = APIRouter()
api_router.include_router(patients_router)
api_router.include_router(dicom_import_router)
api_router.include_router(studies_router)
api_router.include_router(instances_router)
api_router.include_router(viewer_states_router)
api_router.include_router(import_jobs_router)

__all__ = ["api_router"]
