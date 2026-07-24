from __future__ import annotations

import math
import unicodedata
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

from app.models.viewer_state import ViewerState


ViewerViewport = Literal["axial", "coronal", "sagittal"]
PersistedToolName = Literal["Length", "Angle", "RectangleROI", "ArrowAnnotate"]
AxialTool = Literal[
    "windowLevel",
    "pan",
    "zoom",
    "length",
    "angle",
    "rectangleRoi",
    "arrowAnnotate",
    "eraseAnnotation",
]
MprTool = Literal[
    "crosshairs",
    "windowLevel",
    "pan",
    "zoom",
    "length",
    "angle",
    "rectangleRoi",
    "arrowAnnotate",
    "eraseAnnotation",
]


def _finite_number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("a finite JSON number is required")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("a finite JSON number is required")
    return result


FiniteNumber = Annotated[float, BeforeValidator(_finite_number)]
Point2 = tuple[FiniteNumber, FiniteNumber]
Point3 = tuple[FiniteNumber, FiniteNumber, FiniteNumber]


class StrictViewerStateModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ViewPresentation(StrictViewerStateModel):
    zoom: FiniteNumber | None = Field(default=None, gt=0)
    pan: Point2 | None = None
    rotation: FiniteNumber | None = None
    flip_horizontal: StrictBool | None = None
    flip_vertical: StrictBool | None = None


class VoiState(StrictViewerStateModel):
    lower: FiniteNumber
    upper: FiniteNumber
    invert: StrictBool

    @model_validator(mode="after")
    def validate_range(self) -> VoiState:
        if self.lower >= self.upper:
            raise ValueError("VOI lower must be smaller than upper")
        return self


class ViewportDisplayState(StrictViewerStateModel):
    presentation: ViewPresentation | None = None
    voi: VoiState | None = None


class MprViewports(StrictViewerStateModel):
    axial: ViewportDisplayState
    coronal: ViewportDisplayState
    sagittal: ViewportDisplayState


class AxialState(StrictViewerStateModel):
    image_index: int = Field(ge=0)
    active_tool: AxialTool
    presentation: ViewPresentation | None = None
    voi: VoiState | None = None

    @field_validator("image_index", mode="before")
    @classmethod
    def validate_image_index(cls, value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("image index must be an integer")
        return value


class MprState(StrictViewerStateModel):
    active_viewport: ViewerViewport
    active_tool: MprTool
    crosshairs_visible: StrictBool
    crosshairs_position: Point3
    viewports: MprViewports


class WorldBoundingBox(StrictViewerStateModel):
    top_left: Point3
    top_right: Point3
    bottom_left: Point3
    bottom_right: Point3


class AnnotationTextBox(StrictViewerStateModel):
    has_moved: StrictBool
    world_position: Point3
    world_bounding_box: WorldBoundingBox


class PersistedAnnotation(StrictViewerStateModel):
    viewport: ViewerViewport
    tool_name: PersistedToolName
    referenced_image_id: str = Field(min_length=1, max_length=2_048)
    points: list[Point3]
    label: str | None
    text_box: AnnotationTextBox | None

    @model_validator(mode="after")
    def validate_tool_payload(self) -> PersistedAnnotation:
        if any(
            unicodedata.category(character) == "Cc"
            for character in self.referenced_image_id
        ):
            raise ValueError("annotation image identity contains control characters")
        expected_points = {
            "Length": 2,
            "Angle": 3,
            "RectangleROI": 4,
            "ArrowAnnotate": 2,
        }
        if len(self.points) != expected_points[self.tool_name]:
            raise ValueError("annotation point count does not match its tool")

        if self.tool_name == "ArrowAnnotate":
            if self.label is None:
                raise ValueError("arrow annotation text is required")
            normalized = self.label.strip()
            if not 1 <= len(normalized) <= 200:
                raise ValueError("arrow annotation text length is invalid")
            if any(unicodedata.category(character) == "Cc" for character in normalized):
                raise ValueError("arrow annotation text contains control characters")
            self.label = normalized
        elif self.label is not None:
            raise ValueError("only arrow annotations may contain label text")
        return self


class ViewerStatePayload(StrictViewerStateModel):
    axial: AxialState | None = None
    mpr: MprState | None = None
    annotations: list[PersistedAnnotation] = Field(default_factory=list, max_length=500)


class ViewerStateWrite(StrictViewerStateModel):
    schema_version: Literal[1]
    state: ViewerStatePayload


class ViewerStateRead(StrictViewerStateModel):
    series_id: UUID = Field(json_schema_extra={"readOnly": True})
    schema_version: Literal[1]
    state: ViewerStatePayload
    created_at: datetime = Field(json_schema_extra={"readOnly": True})
    updated_at: datetime = Field(json_schema_extra={"readOnly": True})

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def restore_utc_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @classmethod
    def from_viewer_state(cls, state: ViewerState) -> ViewerStateRead:
        return cls.model_validate(
            {
                "series_id": state.series_id,
                "schema_version": state.schema_version,
                "state": state.payload,
                "created_at": state.created_at,
                "updated_at": state.updated_at,
            }
        )
