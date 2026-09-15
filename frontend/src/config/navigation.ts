import {
  LayoutDashboard,
  BookOpen,
  GraduationCap,
  Users,
  Settings,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@/types/database.types';

export interface NavItem {
  labelKey: 'dashboard' | 'myCourses' | 'browseCourses' | 'students' | 'courses' | 'instructors' | 'aiModels' | 'settings';
  path: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    labelKey: 'dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    roles: ['student', 'instructor', 'admin'],
  },
  {
    labelKey: 'myCourses',
    path: '/courses',
    icon: BookOpen,
    roles: ['student', 'instructor'],
  },
  {
    labelKey: 'browseCourses',
    path: '/browse',
    icon: GraduationCap,
    roles: ['student'],
  },
  {
    labelKey: 'students',
    path: '/students',
    icon: Users,
    roles: ['instructor', 'admin'],
  },
  {
    labelKey: 'courses',
    path: '/dashboard/admin/courses',
    icon: BookOpen,
    roles: ['admin'],
  },
  {
    labelKey: 'instructors',
    path: '/instructors',
    icon: Users,
    roles: ['admin'],
  },
  {
    labelKey: 'aiModels',
    path: '/ai-models',
    icon: Cpu,
    roles: ['admin'],
  },
  {
    labelKey: 'settings',
    path: '/settings',
    icon: Settings,
    roles: ['student', 'instructor', 'admin'],
  },
];

export function getNavItemsForRole(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export function getDashboardPathForRole(role: UserRole | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'instructor':
      return '/instructor';
    case 'student':
      return '/student';
    default:
      return '/auth/sign-in';
  }
}
