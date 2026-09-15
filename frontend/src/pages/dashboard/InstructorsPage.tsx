import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  BriefcaseBusiness,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import {
  readLocalCourses,
  readLocalUsers,
  writeLocalUsers,
  type LocalCourseRecord,
  type LocalInstructorPermission,
  type LocalUserRecord,
} from '@/lib/localDb';
import { AdminInstructorsEnhancements } from '@/components/dashboard/AdminInstructorsEnhancements';
import { useTranslation } from '@/context/I18nContext';

type InstructorStatus = 'active' | 'inactive' | 'suspended';

type InstructorRow = {
  id: string;
  name: string;
  email: string;
  specialty: string;
  status: InstructorStatus;
  joinedAt: string;
  permissions: LocalInstructorPermission;
  courseIds: string[];
  assignedCourses: LocalCourseRecord[];
};

type InstructorFormState = {
  id: string | null;
  fullName: string;
  email: string;
  specialty: string;
  status: InstructorStatus;
  password: string;
  permissions: LocalInstructorPermission;
  courseIds: string[];
};

const defaultPermissions: LocalInstructorPermission = {
  manageCourses: true,
  moderateStudents: true,
  viewAnalytics: true,
};

const emptyForm = (): InstructorFormState => ({
  id: null,
  fullName: '',
  email: '',
  specialty: 'General Instruction',
  status: 'active',
  password: '',
  permissions: { ...defaultPermissions },
  courseIds: [],
});

const statusStyles: Record<InstructorStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  inactive: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  suspended: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300',
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function mapInstructorRow(user: LocalUserRecord, allCourses: LocalCourseRecord[]): InstructorRow {
  const courseIds =
    user.courseIds ??
    allCourses.filter((course) => course.instructorId === user.id).map((course) => course.id);

  return {
    id: user.id,
    name: user.profile.full_name,
    email: user.email,
    specialty: user.specialty ?? 'General Instruction',
    status: user.status ?? 'active',
    joinedAt: user.joinedAt ?? user.profile.created_at,
    permissions: user.permissions ?? { ...defaultPermissions },
    courseIds,
    assignedCourses: allCourses.filter(
      (course) => courseIds.includes(course.id) || course.instructorId === user.id
    ),
  };
}

export function InstructorsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InstructorRow[]>([]);
  const [availableCourses, setAvailableCourses] = useState<LocalCourseRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InstructorStatus>('all');
  const [specialtyFilter, setSpecialtyFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<InstructorFormState>(emptyForm());

  const loadInstructors = () => {
    try {
      setLoading(true);
      setError(null);

      const users = readLocalUsers().filter((user) => user.role === 'instructor');
      const allCourses = readLocalCourses();

      setAvailableCourses(allCourses);

      const nextRows = users.map((user) => mapInstructorRow(user, allCourses));
      setRows(nextRows);

      if (nextRows.length > 0 && !selectedId) {
        setSelectedId(nextRows[0].id);
      }
    } catch (loadError) {
      console.error('Failed to load instructor records:', loadError);
      setError('Unable to load instructor records from the local platform database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInstructors();
  }, []);

  const specialties = useMemo(
    () => Array.from(new Set(rows.map((row) => row.specialty))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesSearch =
        row.name.toLowerCase().includes(search.toLowerCase()) ||
        row.email.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
      const matchesSpecialty = specialtyFilter === 'all' || row.specialty === specialtyFilter;

      return matchesSearch && matchesStatus && matchesSpecialty;
    });
  }, [rows, search, specialtyFilter, statusFilter]);

  const selectedInstructor = useMemo(
    () => filteredRows.find((row) => row.id === selectedId) ?? filteredRows[0] ?? null,
    [filteredRows, selectedId]
  );

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsModalOpen(true);
  };

  const openEditModal = (row: InstructorRow) => {
    setEditingId(row.id);
    setForm({
      id: row.id,
      fullName: row.name,
      email: row.email,
      specialty: row.specialty,
      status: row.status,
      password: '',
      permissions: { ...row.permissions },
      courseIds: [...row.courseIds],
    });
    setIsModalOpen(true);
  };

  const updateFormValue = <K extends keyof InstructorFormState>(
    key: K,
    value: InstructorFormState[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveInstructor = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const fullName = form.fullName.trim();
    const email = form.email.trim();
    const specialty = form.specialty.trim() || 'General Instruction';

    if (!fullName || !email) {
      setError('Instructor name and email are required.');
      return;
    }

    try {
      const users = readLocalUsers();
      const now = new Date().toISOString();

      const targetUser = users.find((user) => user.id === form.id);
      const nextUsers: LocalUserRecord[] = [...users];

      if (targetUser) {
        const userIndex = nextUsers.findIndex((user) => user.id === targetUser.id);
        const updatedUser: LocalUserRecord = {
          ...targetUser,
          email: email.toLowerCase(),
          password: form.password || targetUser.password,
          status: form.status as LocalUserRecord['status'],
          specialty,
          joinedAt: targetUser.joinedAt ?? now,
          permissions: form.permissions,
          courseIds: form.courseIds,
          profile: {
            ...targetUser.profile,
            full_name: fullName,
            updated_at: now,
          },
        };
        nextUsers[userIndex] = updatedUser;
      } else {
        const userId = crypto.randomUUID();
        const newUser: LocalUserRecord = {
          id: userId,
          name: fullName,
          email: email.toLowerCase(),
          password: form.password || 'instructor123',
          role: 'instructor',
          avatar: null,
          status: form.status as LocalUserRecord['status'],
          specialty,
          joinedAt: now,
          permissions: form.permissions,
          courseIds: form.courseIds,
          profile: {
            id: userId,
            full_name: fullName,
            role: 'instructor',
            avatar_url: null,
            bio: 'Instructor and course mentor.',
            created_at: now,
            updated_at: now,
          },
        };
        nextUsers.push(newUser);
      }

      writeLocalUsers(nextUsers);
      setIsModalOpen(false);
      setForm(emptyForm());
      setError(null);
      setSelectedId(targetUser?.id ?? nextUsers[nextUsers.length - 1].id);
      loadInstructors();
    } catch (saveError) {
      console.error('Failed to save instructor:', saveError);
      setError('Unable to save the instructor record.');
    }
  };

  const toggleInstructorStatus = (instructorId: string) => {
    try {
      const users = readLocalUsers();
      const nextUsers: LocalUserRecord[] = users.map((user) => {
        if (user.id !== instructorId || user.role !== 'instructor') {
          return user;
        }

        const nextStatus: LocalUserRecord['status'] =
          user.status === 'active' ? 'inactive' : 'active';
        return { ...user, status: nextStatus };
      });

      writeLocalUsers(nextUsers);
      setRows((current) =>
        current.map((row) =>
          row.id === instructorId
            ? { ...row, status: row.status === 'active' ? 'inactive' : 'active' }
            : row
        )
      );
    } catch (saveError) {
      console.error('Failed to update status:', saveError);
      setError('Unable to update the instructor status.');
    }
  };

  const deleteInstructor = (instructorId: string) => {
    const row = rows.find((entry) => entry.id === instructorId);
    if (!row) return;

    const confirmed = window.confirm(
      `${t('common.deleteConfirm')} ${row.name}`
    );

    if (!confirmed) return;

    try {
      const users = readLocalUsers();
      const nextUsers = users.filter((user) => user.id !== instructorId);
      writeLocalUsers(nextUsers);
      setRows((current) => current.filter((entry) => entry.id !== instructorId));
      setSelectedId((current) => (current === instructorId ? null : current));
      setIsModalOpen(false);
      setError(null);
    } catch (deleteError) {
      console.error('Failed to delete instructor:', deleteError);
      setError('Unable to delete the instructor profile.');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[32vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
          Loading instructors…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
            {t('instructors.staff')}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{t('instructors.title')}</h1>
        </div>

        <button type="button" className="btn-primary" onClick={openCreateModal}>
          <Plus className="h-4 w-4" />
          {t('instructors.add')}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instructors.total')}</p>
            <Users className="h-5 w-5 text-primary-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{rows.length}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('instructors.activeMentors')}
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instructors.active')}</p>
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
            {rows.filter((row) => row.status === 'active').length}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('instructors.readyToTeach')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instructors.assignments')}</p>
            <BookOpen className="h-5 w-5 text-violet-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
            {rows.reduce((sum, row) => sum + row.courseIds.length, 0)}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('instructors.coursesAssigned')}</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('instructors.permissions')}</p>
            <ShieldCheck className="h-5 w-5 text-cyan-600" />
          </div>
          <p className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">
            {rows.filter((row) => row.permissions.manageCourses).length}
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('instructors.courseManagers')}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('instructors.directory')}
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('instructors.search')}
                  className="input-field w-full pl-10 sm:w-64"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | InstructorStatus)
                }
                className="input-field sm:w-40"
              >
                <option value="all">{t('instructors.allStatuses')}</option>
                <option value="active">{t('common.active')}</option>
                <option value="inactive">{t('common.inactive')}</option>
                <option value="suspended">{t('common.suspended')}</option>
              </select>

              <select
                value={specialtyFilter}
                onChange={(event) => setSpecialtyFilter(event.target.value)}
                className="input-field sm:w-48"
              >
                <option value="all">{t('instructors.allSpecialties')}</option>
                {specialties.map((specialty) => (
                  <option key={specialty} value={specialty}>
                    {specialty}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-gray-50 text-xs uppercase tracking-[0.12em] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">
              <tr>
                <th className="px-5 py-3">{t('instructors.title')}</th>
                <th className="px-5 py-3">{t('instructors.specialty')}</th>
                <th className="px-5 py-3">{t('students.courses')}</th>
                <th className="px-5 py-3">{t('common.status')}</th>
                <th className="px-5 py-3">{t('instructors.joined')}</th>
                <th className="px-5 py-3 text-right">{t('instructors.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    {t('instructors.empty')}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-gray-200 transition-colors dark:border-gray-800 ${
                      selectedInstructor?.id === row.id
                        ? 'bg-primary-50/60 dark:bg-primary-950/20'
                        : ''
                    }`}
                  >
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <p className="font-semibold text-gray-900 dark:text-white">{row.name}</p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{row.email}</p>
                      </button>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {row.specialty}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
                      {row.courseIds.length}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          statusStyles[row.status]
                        }`}
                      >
                        {row.status === 'active'
                          ? t('common.active')
                          : row.status === 'inactive'
                            ? t('common.inactive')
                            : t('common.suspended')}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {formatDate(row.joinedAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-2"
                          onClick={() => openEditModal(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-2 text-amber-600 dark:text-amber-300"
                          onClick={() => toggleInstructorStatus(row.id)}
                        >
                          <UserRoundX className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary px-2.5 py-2 text-red-600 dark:text-red-300"
                          onClick={() => deleteInstructor(row.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedInstructor && (
        <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  Instructor profile
                </p>
                <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
                  {selectedInstructor.name}
                </h2>
              </div>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                  statusStyles[selectedInstructor.status]
                }`}
              >
                {selectedInstructor.status}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                <p className="mt-2 font-medium text-gray-900 dark:text-white">
                  {selectedInstructor.email}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm text-gray-500 dark:text-gray-400">Specialty</p>
                <p className="mt-2 font-medium text-gray-900 dark:text-white">
                  {selectedInstructor.specialty}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm text-gray-500 dark:text-gray-400">Joined</p>
                <p className="mt-2 font-medium text-gray-900 dark:text-white">
                  {formatDate(selectedInstructor.joinedAt)}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
                <p className="text-sm text-gray-500 dark:text-gray-400">Assigned courses</p>
                <p className="mt-2 font-medium text-gray-900 dark:text-white">
                  {selectedInstructor.courseIds.length}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Permissions</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(selectedInstructor.permissions).map(([key, value]) => (
                  <span
                    key={key}
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      value
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  Course overview
                </p>
                <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Assigned learning tracks
                </h2>
              </div>
              <BriefcaseBusiness className="h-5 w-5 text-violet-600" />
            </div>

            <div className="mt-5 space-y-3">
              {selectedInstructor.assignedCourses.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  This instructor has no assigned courses yet.
                </div>
              ) : (
                selectedInstructor.assignedCourses.map((course) => (
                  <div
                    key={course.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{course.title}</p>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          {course.category}
                        </p>
                      </div>
                      <span className="rounded-full bg-primary-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
                        {course.difficulty}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                  {editingId ? 'Edit instructor' : 'Create instructor'}
                </p>
                <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
                  {editingId ? 'Update account details' : 'Register a new instructor'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={saveInstructor}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="label-text">Full name</label>
                  <input
                    value={form.fullName}
                    onChange={(event) => updateFormValue('fullName', event.target.value)}
                    className="input-field"
                    placeholder="Jordan Smith"
                  />
                </div>

                <div>
                  <label className="label-text">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => updateFormValue('email', event.target.value)}
                    className="input-field"
                    placeholder="instructor@learnflow.io"
                  />
                </div>

                <div>
                  <label className="label-text">Specialty</label>
                  <input
                    value={form.specialty}
                    onChange={(event) => updateFormValue('specialty', event.target.value)}
                    className="input-field"
                    placeholder="AI & Automation"
                  />
                </div>

                <div>
                  <label className="label-text">Status</label>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateFormValue('status', event.target.value as InstructorStatus)
                    }
                    className="input-field"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {!editingId && (
                <div>
                  <label className="label-text">Initial password</label>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(event) => updateFormValue('password', event.target.value)}
                    className="input-field"
                    placeholder="instructor123"
                  />
                </div>
              )}

              <div>
                <label className="label-text">Permissions</label>
                <div className="grid gap-3 sm:grid-cols-3">
                  {Object.entries(form.permissions).map(([key, value]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-200"
                    >
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(event) =>
                          updateFormValue('permissions', {
                            ...form.permissions,
                            [key]: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="label-text">Course assignments</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {availableCourses.map((course) => (
                    <label
                      key={course.id}
                      className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-200"
                    >
                      <input
                        type="checkbox"
                        checked={form.courseIds.includes(course.id)}
                        onChange={(event) => {
                          const nextCourseIds = event.target.checked
                            ? [...form.courseIds, course.id]
                            : form.courseIds.filter((candidate) => candidate !== course.id);
                          updateFormValue('courseIds', nextCourseIds);
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span>{course.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-5 dark:border-gray-800">
                {editingId && (
                  <button
                    type="button"
                    className="btn-secondary border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                    onClick={() => deleteInstructor(editingId)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingId ? 'Save changes' : 'Create instructor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AdminInstructorsEnhancements />
    </div>
  );
}