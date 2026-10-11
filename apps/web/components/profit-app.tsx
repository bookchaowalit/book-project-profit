'use client';

import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Project, Workspace, WorkspaceSummary } from '@/lib/api-types';
import { changedRows, type RowKey } from '@/lib/forms';
import { formatMoney, isCurrency } from '@/lib/money';
import { Comparison } from './comparison';
import { usePaged, useLoad } from './hooks';
import { Overview } from './overview';
import { ProjectForm, WorkspaceForm } from './project-forms';
import { RecordAction, Transactions } from './transactions';
import { ErrorNotice, Loading, StaleNotice } from './ui';
import type { EntryKind } from '@/lib/api-types';

const FLASH_MS = 1400;
const NO_ROWS: ReadonlySet<RowKey> = new Set();

/** Rows whose canonical values changed after a refetch of the same project. */
function useChangedRows(project: Project | undefined, key: string): ReadonlySet<RowKey> {
  const previous = useRef<{ key: string; project: Project } | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<RowKey>>(NO_ROWS);
  useEffect(() => {
    if (!project) return;
    const before = previous.current;
    previous.current = { key, project };
    if (!before || before.key !== key || before.project === project) {
      setChanged(NO_ROWS);
      return;
    }
    const diff = changedRows(before.project, project);
    if (diff.size === 0) {
      setChanged(NO_ROWS);
      return;
    }
    setChanged(diff);
    const timer = setTimeout(() => setChanged(NO_ROWS), FLASH_MS);
    return () => clearTimeout(timer);
  }, [project, key]);
  return changed;
}

export function ProfitApp({ displayName }: { displayName: string }) {
  const [wid, setWid] = useState<string | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [projectsRefresh, setProjectsRefresh] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [authExpired, setAuthExpired] = useState(false);
  const [entryKind, setEntryKind] = useState<EntryKind>('time-entries');
  const [focusRequest, setFocusRequest] = useState(0);
  const [pendingSave, setPendingSave] = useState<{ base: number; afterWrite: boolean } | null>(null);
  const [savedStale, setSavedStale] = useState(false);

  const workspaces = useLoad<{ items: Workspace[]; total: number }>('workspaces', (signal) =>
    apiRequest('/workspaces', { signal }),
  );
  const workspace = workspaces.data?.items.find((w) => w.id === wid);
  const canWrite = !!workspace && workspace.role !== 'viewer';

  useEffect(() => {
    const first = workspaces.data?.items[0];
    if (wid === null && first) setWid(first.id);
  }, [workspaces.data, wid]);

  const summary = useLoad<WorkspaceSummary>(wid ? `summary:${wid}` : null, (signal) =>
    apiRequest(`/workspaces/${encodeURIComponent(wid!)}/summary`, { signal }),
  );
  const projects = usePaged<Project>(wid ? `/workspaces/${encodeURIComponent(wid)}/projects` : null, projectsRefresh);

  useEffect(() => {
    if (pid === null && projects.items[0]) setPid(projects.items[0].id);
  }, [projects.items, pid]);

  const projectKey = wid && pid ? `project:${wid}:${pid}` : null;
  const project = useLoad<Project>(projectKey, (signal) =>
    apiRequest(`/workspaces/${encodeURIComponent(wid!)}/projects/${encodeURIComponent(pid!)}`, { signal }),
  );
  const changed = useChangedRows(project.data, projectKey ?? '');

  const unauthorized = [workspaces.error, summary.error, project.error, projects.error].some((e) => e?.code === 'unauthorized');
  useEffect(() => {
    if (unauthorized) setAuthExpired(true);
  }, [unauthorized]);

  function selectWorkspace(id: string) {
    setWid(id);
    setPid(null);
    setEditing(false);
    setShowProjectForm(false);
  }

  function selectProject(id: string) {
    setPid(id);
    setEditing(false);
    setShowProjectForm(false);
  }

  function saved(message: string) {
    // The write is persisted; totals are only "recalculated" once the canonical GET succeeds.
    setAnnouncement(`${message} กำลังโหลดผลรวมล่าสุด…`);
    setSavedStale(false);
    setPendingSave({ base: project.settled, afterWrite: true });
    project.reload();
    summary.reload();
    setRefresh((n) => n + 1);
  }

  function retryProject() {
    setPendingSave({ base: project.settled, afterWrite: savedStale });
    project.reload();
  }

  useEffect(() => {
    if (!pendingSave || project.settled <= pendingSave.base || project.loading) return;
    setPendingSave(null);
    if (project.error) {
      setSavedStale(pendingSave.afterWrite);
      setAnnouncement(
        pendingSave.afterWrite
          ? 'บันทึกสำเร็จแล้ว แต่โหลดผลรวมล่าสุดไม่สำเร็จ ตัวเลขที่แสดงเป็นค่าเก่า'
          : 'โหลดผลรวมล่าสุดไม่สำเร็จ ตัวเลขที่แสดงเป็นค่าเก่า',
      );
    } else {
      setAnnouncement('โหลดผลรวมล่าสุดสำเร็จ ผลเปรียบเทียบอัปเดตแล้ว');
    }
  }, [pendingSave, project.settled, project.loading, project.error]);

  useEffect(() => {
    if (!project.error) setSavedStale(false);
  }, [project.error]);

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json' } });
    } finally {
      window.location.assign('/');
    }
  }

  const reportError = (e: { code: string }) => {
    if (e.code === 'unauthorized') setAuthExpired(true);
  };

  const noWorkspaces = workspaces.data && workspaces.data.items.length === 0;
  const items = workspaces.data?.items ?? [];

  return (
    <div className="app">
      <a className="skip" href="#main">
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <header className="bar">
        <h1 className="brand">กำไรโปรเจกต์</h1>
        <div className="bar-workspace">
          <label htmlFor="workspace-select">เวิร์กสเปซ</label>
          <select
            id="workspace-select"
            value={wid ?? ''}
            disabled={items.length === 0}
            onChange={(e) => selectWorkspace(e.target.value)}
          >
            {items.length === 0 ? <option value="">{workspaces.loading ? 'กำลังโหลด…' : 'ยังไม่มีเวิร์กสเปซ'}</option> : null}
            {items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {workspace ? <span className="muted small">บทบาท {workspace.role}</span> : null}
          <button type="button" className="button" aria-expanded={showWorkspaceForm} onClick={() => setShowWorkspaceForm((v) => !v)}>
            สร้างเวิร์กสเปซ
          </button>
        </div>
        <div className="bar-user">
          <span className="user-name">{displayName}</span>
          <button type="button" className="button" onClick={signOut}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {authExpired ? (
        <div role="alert" className="notice notice-error banner">
          <strong>เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ</strong>
          <p>
            ระบบจะไม่ลองเรียกซ้ำเอง <a href="/api/auth/login">เข้าสู่ระบบอีกครั้ง</a> เพื่อใช้งานต่อ
          </p>
        </div>
      ) : null}

      {showWorkspaceForm || noWorkspaces ? (
        <div className="bar-form">
          <WorkspaceForm
            onDone={(id) => {
              setShowWorkspaceForm(false);
              setAnnouncement('สร้างเวิร์กสเปซแล้ว');
              selectWorkspace(id);
              workspaces.reload();
            }}
            onCancel={() => setShowWorkspaceForm(false)}
            onError={reportError}
          />
        </div>
      ) : null}

      <div className="layout">
        <nav className="rail" aria-label="โปรเจกต์">
          <div className="rail-head">
            <h2>โปรเจกต์</h2>
            {canWrite ? (
              <button type="button" className="button" aria-expanded={showProjectForm} onClick={() => setShowProjectForm((v) => !v)}>
                เพิ่มโปรเจกต์
              </button>
            ) : null}
          </div>
          {projects.loading ? <Loading label="กำลังโหลดโปรเจกต์…" /> : null}
          {projects.error && projects.items.length === 0 ? <ErrorNotice error={projects.error} onRetry={projects.reload} /> : null}
          {projects.items.length > 0 ? (
            <>
              <label htmlFor="project-select" className="project-select-label">
                เลือกโปรเจกต์
              </label>
              <select id="project-select" className="project-select" value={pid ?? ''} onChange={(e) => selectProject(e.target.value)}>
                {projects.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.client_name} ({p.currency})
                  </option>
                ))}
              </select>
              <ul className="project-list">
                {projects.items.map((p) => (
                  <li key={p.id}>
                    <button type="button" aria-current={p.id === pid ? 'true' : undefined} onClick={() => selectProject(p.id)}>
                      <span className="project-name">{p.name}</span>
                      <span className="project-meta">
                        {p.client_name} · {p.currency}
                        {p.status !== 'active' ? ` · ${p.status === 'completed' ? 'เสร็จแล้ว' : 'เก็บเข้าคลัง'}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {wid ? (
            <p className="muted small" role="status">
              แสดง {projects.items.length} จากทั้งหมด {projects.total} โปรเจกต์
            </p>
          ) : null}
          {projects.error && projects.items.length > 0 ? (
            <>
              <p className="muted small">รายการโปรเจกต์ที่แสดงอาจไม่ล่าสุด (โหลดใหม่ไม่สำเร็จ)</p>
              <ErrorNotice error={projects.error} onRetry={projects.reload} />
            </>
          ) : null}
          {projects.moreError ? <ErrorNotice error={projects.moreError} onRetry={projects.loadMore} /> : null}
          {projects.total > projects.items.length ? (
            <button type="button" className="button" onClick={projects.loadMore} disabled={projects.loadingMore || projects.refreshing}>
              {projects.loadingMore ? 'กำลังโหลด…' : `โหลดโปรเจกต์เพิ่ม (เหลือ ${projects.total - projects.items.length})`}
            </button>
          ) : null}
          {wid ? (
            <p>
              <a href="#overview">ภาพรวมแยกตามสกุลเงิน</a>
            </p>
          ) : null}
        </nav>

        <main id="main" className="main" tabIndex={-1}>
          {workspaces.loading ? <Loading label="กำลังโหลดเวิร์กสเปซ…" /> : null}
          {workspaces.error ? <ErrorNotice error={workspaces.error} onRetry={workspaces.reload} /> : null}
          {noWorkspaces ? (
            <p className="empty">
              ยังไม่มีเวิร์กสเปซ สร้างเวิร์กสเปซแรกด้วยฟอร์มด้านบน แล้วจึงเพิ่มโปรเจกต์และบันทึกรายการ
            </p>
          ) : null}

          {wid && canWrite && (showProjectForm || (!projects.loading && !projects.error && projects.total === 0)) ? (
            <section className="sheet" aria-label="สร้างโปรเจกต์">
              <h2>สร้างโปรเจกต์</h2>
              {projects.total === 0 ? (
                <p className="muted">
                  เริ่มจากกรอกมูลค่าสัญญาและต้นทุนแรงงานต่อชั่วโมง จากนั้นบันทึกเวลา ค่าใช้จ่าย และเงินที่ได้รับเพื่อดูกำไรจริง
                </p>
              ) : null}
              <ProjectForm
                key={`create-${wid}`}
                mode="create"
                workspaceId={wid}
                onDone={(created) => {
                  setShowProjectForm(false);
                  setProjectsRefresh((n) => n + 1);
                  summary.reload();
                  setAnnouncement('สร้างโปรเจกต์แล้ว');
                  setPid(created.id);
                }}
                onCancel={projects.total > 0 ? () => setShowProjectForm(false) : undefined}
                onError={reportError}
              />
            </section>
          ) : null}

          {wid && !canWrite && workspace && projects.total === 0 && !projects.loading ? (
            <p className="empty">เวิร์กสเปซนี้ยังไม่มีโปรเจกต์ และบทบาทของคุณอ่านได้อย่างเดียว</p>
          ) : null}

          {projectKey && project.loading && !project.data ? <Loading label="กำลังโหลดโปรเจกต์…" /> : null}
          {project.error && !project.data ? <ErrorNotice error={project.error} onRetry={project.reload} /> : null}
          {project.data && wid ? (
            <>
              {canWrite ? (
                <div className="project-actions">
                  <button type="button" className="button" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
                    แก้ไขโปรเจกต์
                  </button>
                </div>
              ) : null}
              {editing ? (
                <section className="sheet" aria-label="แก้ไขโปรเจกต์">
                  <h2>แก้ไขโปรเจกต์</h2>
                  <ProjectForm
                    key={project.data.id + project.data.updated_at}
                    mode="edit"
                    workspaceId={wid}
                    project={project.data}
                    onDone={() => {
                      setEditing(false);
                      setProjectsRefresh((n) => n + 1);
                      saved('บันทึกการแก้ไขโปรเจกต์แล้ว');
                    }}
                    onCancel={() => setEditing(false)}
                    onError={reportError}
                  />
                </section>
              ) : null}
              {project.data && project.error ? (
                <StaleNotice error={project.error} subject="ตัวเลขโปรเจกต์" saved={savedStale} onRetry={retryProject} />
              ) : null}
              {project.loading ? (
                <p role="status" className="muted small refresh-status">
                  กำลังโหลดผลรวมล่าสุด…
                </p>
              ) : null}
              <Comparison
                project={project.data}
                changed={changed}
                stale={!!project.error}
                actions={
                  canWrite ? (
                    <RecordAction
                      kind={entryKind}
                      onKind={setEntryKind}
                      onGo={() => setFocusRequest((n) => n + 1)}
                    />
                  ) : null
                }
              />
              {isCurrency(project.data.currency) ? (
                <Transactions
                  key={`${wid}:${project.data.id}`}
                  kind={entryKind}
                  onKind={setEntryKind}
                  focusRequest={focusRequest}
                  basePath={`/workspaces/${encodeURIComponent(wid)}/projects/${encodeURIComponent(project.data.id)}`}
                  currency={project.data.currency}
                  canWrite={canWrite}
                  defaultHourlyHint={`(ตอนนี้ ${formatMoney(project.data.hourly_cost_minor, project.data.currency)})`}
                  refresh={refresh}
                  onSaved={saved}
                  onError={reportError}
                />
              ) : null}
            </>
          ) : null}

          {wid ? (
            <>
              {summary.data && summary.error ? (
                <StaleNotice error={summary.error} subject="ภาพรวมเวิร์กสเปซ" onRetry={summary.reload} />
              ) : null}
              {summary.data && summary.loading ? (
                <p role="status" className="muted small refresh-status">
                  กำลังโหลดภาพรวมล่าสุด…
                </p>
              ) : null}
              {summary.data ? (
                <Overview summary={summary.data} />
              ) : summary.error ? (
                <ErrorNotice error={summary.error} onRetry={summary.reload} />
              ) : (
                <Loading label="กำลังโหลดภาพรวม…" />
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
