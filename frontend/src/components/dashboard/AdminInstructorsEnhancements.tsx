import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Check, Eye, ExternalLink, ShieldAlert, X } from 'lucide-react';
import {
  fetchAdminCourseInventory,
  fetchAdminInstructors,
  prepareInstructorImpersonation,
  reassignInstructorCourses,
  updateAdminInstructor,
  type AdminInstructor,
} from '@/lib/adminInstructorRepository';
import type { AdminCourse } from '@/lib/adminCourseRepository';
import { writeLocalSession } from '@/lib/localDb';
import { useTranslation } from '@/context/I18nContext';

export function AdminInstructorsEnhancements() {
  const { t, formatNumber, formatCurrency } = useTranslation();
  const [rows, setRows] = useState<AdminInstructor[]>([]);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchAdminInstructors(), fetchAdminCourseInventory()])
      .then(([nextRows, nextCourses]) => {
        if (!isMounted) return;
        setRows(nextRows);
        setCourses(nextCourses);
      })
      .catch((reason: unknown) => {
        console.error('Unable to load instructor controls:', reason);
        if (isMounted) setError(t('adminInstructors.loadError'));
      });
    return () => {
      isMounted = false;
    };
  }, [t]);

  const visible = useMemo(
    () => rows.filter((row) => !pendingOnly || row.verification_status === 'pending'),
    [pendingOnly, rows],
  );

  const update = async (id: string, values: Parameters<typeof updateAdminInstructor>[1]) => {
    try {
      const updated = await updateAdminInstructor(id, values);
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...updated } as AdminInstructor : row));
    } catch (reason: unknown) {
      console.error('Instructor update failed:', reason);
      setError(t('adminInstructors.updateError'));
    }
  };

  const impersonate = async (row: AdminInstructor) => {
    try {
      const session = await prepareInstructorImpersonation(row.id);
      const adminToken = window.sessionStorage.getItem('learnflow_session_token');
      if (adminToken) window.sessionStorage.setItem('learnflow_admin_return_token', adminToken);
      window.sessionStorage.setItem('learnflow_session_token', session.access_token);
      writeLocalSession({ userId: session.user_id, email: session.email });
      window.location.href = '/instructor';
    } catch (reason: unknown) {
      console.error('Instructor impersonation failed:', reason);
      setError(t('adminInstructors.impersonationError'));
    }
  };

  const reassign = async (row: AdminInstructor) => {
    const ids = assignmentDraft[row.id] ?? courses.filter((course) => course.instructor_id === row.id).map((course) => course.id);
    try {
      await reassignInstructorCourses(row.id, ids);
      setAssignmentDraft((current) => ({ ...current, [row.id]: ids }));
      const [nextRows, nextCourses] = await Promise.all([fetchAdminInstructors(), fetchAdminCourseInventory()]);
      setRows(nextRows);
      setCourses(nextCourses);
    } catch (reason: unknown) {
      console.error('Course reassignment failed:', reason);
      setError(t('adminInstructors.reassignmentError'));
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'pending') return t('adminInstructors.pending');
    if (status === 'approved') return t('adminInstructors.approved');
    if (status === 'rejected') return t('adminInstructors.rejected');
    if (status === 'suspended') return t('common.suspended');
    return status === 'active' ? t('common.active') : t('common.inactive');
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5 dark:border-gray-800">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-primary-600">{t('adminInstructors.controls')}</p>
          <h2 className="text-lg font-semibold">{t('adminInstructors.operations')}</h2>
        </div>
        <button
          type="button"
          aria-pressed={pendingOnly}
          onClick={() => setPendingOnly((value) => !value)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${pendingOnly ? 'bg-primary-600 text-white' : 'border border-gray-200 dark:border-gray-700'}`}
        >
          {t('adminInstructors.verificationRequests', {
            count: formatNumber(rows.filter((row) => row.verification_status === 'pending').length),
          })}
        </button>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600" role="alert">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-start">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900/60">
            <tr>
              <th className="px-5 py-3">{t('courses.instructor')}</th>
              <th className="px-5 py-3">{t('adminInstructors.financialSummary')}</th>
              <th className="px-5 py-3">{t('adminInstructors.payout')}</th>
              <th className="px-5 py-3">{t('adminInstructors.courseReassignment')}</th>
              <th className="px-5 py-3 text-end">{t('adminInstructors.controls')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const assigned = assignmentDraft[row.id] ?? courses.filter((course) => course.instructor_id === row.id).map((course) => course.id);
              return (
                <tr key={row.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-5 py-4">
                    <p className="font-semibold">
                      {row.name} {row.is_verified && <BadgeCheck className="inline h-4 w-4 text-primary-600" />}
                    </p>
                    <p className="text-sm text-gray-500">
                      {statusLabel(row.verification_status)}
                      {row.verification_document_url && (
                        <a href={row.verification_document_url} target="_blank" rel="noreferrer" className="ms-2 text-primary-600" aria-label={t('adminInstructors.openVerificationDocument')}>
                          <ExternalLink className="inline h-3 w-3" />
                        </a>
                      )}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-sm">
                    <p>{t('adminInstructors.courseStudentSummary', {
                      courses: formatNumber(row.total_courses),
                      students: formatNumber(row.enrolled_students),
                    })}</p>
                    <p className="font-semibold">{t('adminInstructors.earnings', { amount: formatCurrency(row.total_earnings) })}</p>
                    <p className="text-xs text-gray-500">{t('adminInstructors.commission', { amount: formatCurrency(row.platform_commission) })}</p>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      disabled={row.payout_status === 'paid'}
                      onClick={() => void update(row.id, { payout_status: 'paid' })}
                      className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-60"
                    >
                      {row.payout_status === 'paid' ? t('adminInstructors.paid') : t('adminInstructors.processPayout')}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <select
                      multiple
                      aria-label={t('adminInstructors.selectCourses', { name: row.name })}
                      value={assigned}
                      onChange={(event) => setAssignmentDraft((current) => ({
                        ...current,
                        [row.id]: Array.from(event.target.selectedOptions, (option) => option.value),
                      }))}
                      className="input-field min-w-48 text-xs"
                    >
                      {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                    </select>
                    <button type="button" className="mt-2 rounded-lg bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700" onClick={() => void reassign(row)}>
                      {t('adminInstructors.saveAssignment')}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      {row.verification_status === 'pending' && (
                        <>
                          <button type="button" className="icon-button text-emerald-600" title={t('adminInstructors.approve')} aria-label={t('adminInstructors.approve')} onClick={() => void update(row.id, { verification_status: 'approved', is_verified: true })}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" className="icon-button text-red-600" title={t('adminInstructors.reject')} aria-label={t('adminInstructors.reject')} onClick={() => void update(row.id, { verification_status: 'rejected', is_verified: false })}>
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <button type="button" className="icon-button" title={t('adminInstructors.impersonate')} aria-label={t('adminInstructors.impersonate')} onClick={() => void impersonate(row)}>
                        <Eye className="h-4 w-4" />
                      </button>
                      <button type="button" className="icon-button text-primary-600" title={t('adminInstructors.toggleVerified')} aria-label={t('adminInstructors.toggleVerified')} onClick={() => void update(row.id, { is_verified: !row.is_verified })}>
                        <BadgeCheck className="h-4 w-4" />
                      </button>
                      <button type="button" className="icon-button text-red-600" title={row.status === 'suspended' ? t('students.activate') : t('students.suspend')} aria-label={row.status === 'suspended' ? t('students.activate') : t('students.suspend')} onClick={() => void update(row.id, { status: row.status === 'suspended' ? 'active' : 'suspended' })}>
                        <ShieldAlert className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-500">{t('adminInstructors.empty')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}