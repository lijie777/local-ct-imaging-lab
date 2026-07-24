from __future__ import annotations

import logging
import threading
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import ApiError, PersistenceError
from app.schemas.dicom_import import ImportReport
from app.services.dicom_import import ImportSource, import_dicom_files
from app.services.import_job_service import (
    active_job_ids,
    claim_next_job,
    complete_job,
    fail_job,
    requeue_running_jobs,
)
from app.services.import_job_storage import ImportJobStorage
from app.services.managed_storage import ManagedStorage


logger = logging.getLogger(__name__)


class ImportJobStagingError(RuntimeError):
    pass


class ImportJobWorker:
    """One serial background worker for durable local import jobs."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        import_storage: ImportJobStorage,
        managed_storage: ManagedStorage,
        wakeup: threading.Event,
    ) -> None:
        self._session_factory = session_factory
        self._import_storage = import_storage
        self._managed_storage = managed_storage
        self._wakeup = wakeup
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.is_alive:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="import-job-worker",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wakeup.set()
        if self._thread is not None:
            # The synchronous DICOM import has no safe in-process cancellation
            # boundary.  Do not let a new lifespan requeue its running job until
            # this worker has finished and fully stopped.
            self._thread.join()

    def _run(self) -> None:
        while not self._stop.is_set():
            claimed = self._claim_one()
            if claimed is None:
                self._wakeup.wait(timeout=0.5)
                self._wakeup.clear()
                continue
            self._process(claimed.id)

    def _claim_one(self):
        with self._session_factory() as session:
            try:
                return claim_next_job(session)
            except PersistenceError:
                logger.warning("Import worker could not claim the next job")
                return None

    def _process(self, job_id: UUID) -> None:
        # The claim is durable; load the manifest in a fresh Session so the
        # import work never shares the claim transaction.
        with self._session_factory() as session:
            from app.models.import_job import ImportJob

            job_model = session.get(ImportJob, job_id)
            if job_model is None:
                return
            try:
                sources: list[ImportSource] = []
                for item in sorted(job_model.files, key=lambda value: value.ordinal):
                    path = self._import_storage.file_path(job_id, item.ordinal)
                    if not path.is_file():
                        raise ImportJobStagingError()
                    sources.append(
                        ImportSource(
                            path=Path(path),
                            display_name=item.relative_path,
                        )
                    )
                report = import_dicom_files(
                    session,
                    job_model.patient_id,
                    sources,
                    self._managed_storage,
                )
                complete_job(session, job_id, report)
                self._cleanup_terminal(job_id)
            except Exception as error:
                session.rollback()
                self._mark_failed(job_id, error)

    def _mark_failed(self, job_id: UUID, error: Exception) -> None:
        if isinstance(error, ApiError):
            code = error.code
            message = error.message
        elif isinstance(error, ImportJobStagingError):
            code = "import_staging_missing"
            message = "导入暂存文件缺失，请删除任务后重试"
        else:
            code = "import_failed"
            message = "后台导入失败，请删除任务后重试"
        with self._session_factory() as session:
            try:
                fail_job(session, job_id, code, message)
            except Exception:
                logger.warning("Import worker could not record a failed job")
        self._cleanup_terminal(job_id)

    def _cleanup_terminal(self, job_id: UUID) -> None:
        try:
            self._import_storage.cleanup_job(job_id)
        except Exception:
            # A terminal DB row is intentionally retained even if cleanup
            # fails; startup orphan cleanup will retry without data loss.
            logger.warning("Import worker could not clean terminal staging")


def recover_import_jobs(
    session_factory: sessionmaker[Session],
    import_storage: ImportJobStorage,
) -> None:
    with session_factory() as session:
        requeue_running_jobs(session)
        protected = active_job_ids(session)
    try:
        import_storage.cleanup_orphans(protected)
    except Exception:
        logger.warning("Import worker could not clean orphan staging")


__all__ = ["ImportJobWorker", "recover_import_jobs"]
