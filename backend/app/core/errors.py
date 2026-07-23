from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field


PUBLIC_VALIDATION_FIELDS = frozenset(
    {
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
    }
)


class FieldError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    code: str
    message: str


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    field_errors: list[FieldError]


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail


class ApiError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        field_errors: list[FieldError] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field_errors = field_errors or []
        self.headers = headers or {}


class PatientNotFoundError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=404,
            code="patient_not_found",
            message="未找到该病人",
        )


class StudyNotFoundError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=404,
            code="study_not_found",
            message="未找到该检查",
        )


class SeriesNotFoundError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=404,
            code="series_not_found",
            message="未找到该序列",
        )


class InstanceNotFoundError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=404,
            code="instance_not_found",
            message="未找到该影像实例",
        )


class SeriesNotViewableError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=409,
            code="series_not_viewable",
            message="该序列暂不可查看",
        )


class ManagedDicomFileMissingError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=410,
            code="dicom_file_missing",
            message="本机 DICOM 文件缺失",
            headers={"Cache-Control": "no-store"},
        )


class MedicalRecordNumberConflictError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=409,
            code="medical_record_no_conflict",
            message="病历号已存在",
            field_errors=[
                FieldError(
                    field="medical_record_no",
                    code="not_unique",
                    message="该病历号已被使用",
                )
            ],
        )


class PersistenceError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=500,
            code="persistence_error",
            message="无法保存本次操作，请重试",
        )


class ImportLimitExceededError(ApiError):
    def __init__(self) -> None:
        super().__init__(
            status_code=413,
            code="import_limit_exceeded",
            message="本次导入的数据量超过教学演示上限",
        )


def _validation_field(error: dict[str, Any]) -> str:
    location = error.get("loc", ())
    if not location:
        return "request"
    candidate = str(location[-1])
    return candidate if candidate in PUBLIC_VALIDATION_FIELDS else "request"


def _validation_message(error: dict[str, Any]) -> str:
    error_type = str(error.get("type", "invalid"))
    if error_type == "missing":
        return "此字段为必填项"
    return "字段值无效"


def _response(error: ApiError) -> ErrorResponse:
    return ErrorResponse(
        error=ErrorDetail(
            code=error.code,
            message=error.message,
            field_errors=error.field_errors,
        )
    )


async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content=_response(error).model_dump(mode="json"),
        headers=error.headers,
    )


async def request_validation_error_handler(
    _request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    field_errors = [
        FieldError(
            field=_validation_field(item),
            code=str(item.get("type", "invalid")),
            message=_validation_message(item),
        )
        for item in error.errors()
    ]
    response = ErrorResponse(
        error=ErrorDetail(
            code="validation_error",
            message="请求字段无效",
            field_errors=field_errors,
        )
    )
    return JSONResponse(status_code=422, content=response.model_dump(mode="json"))


def register_error_handlers(application: FastAPI) -> None:
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(
        RequestValidationError,
        request_validation_error_handler,
    )
