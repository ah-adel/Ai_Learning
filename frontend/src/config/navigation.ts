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
  label: string;
  path: string;
  icon: LucideIcon;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    roles: ['student', 'instructor', 'admin'],
  },
  {
    label: 'My Courses',
    path: '/courses',
    icon: BookOpen,
    roles: ['student', 'instructor'],
  },
  {
    label: 'Browse Courses',
    path: '/browse',
    icon: GraduationCap,
    roles: ['student'],
  },
  {
    label: 'Students',
    path: '/students',
    icon: Users,
    roles: ['instructor', 'admin'],
  },
  {
    label: 'Courses',
    path: '/dashboard/admin/courses',
    icon: BookOpen,
    roles: ['admin'],
  },
  {
    label: 'Instructors',
    path: '/instructors',
    icon: Users,
    roles: ['admin'],
  },
  {
    label: 'AI Models',
    path: '/ai-models',
    icon: Cpu,
    roles: ['admin'],
  },
  {
    label: 'Settings',
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
