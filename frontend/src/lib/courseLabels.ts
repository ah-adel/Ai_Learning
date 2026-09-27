import type { TranslationKey } from '@/context/I18nContext';

type Translate = (key: TranslationKey) => string;

const categoryKeys: Record<string, TranslationKey> = {
  Design: 'courseBuilder.categoryDesign',
  Development: 'courseBuilder.categoryDevelopment',
  Data: 'courseBuilder.categoryData',
  'AI & Automation': 'courseBuilder.categoryAiAutomation',
  Marketing: 'courseBuilder.categoryMarketing',
  Business: 'courseBuilder.categoryBusiness',
  Productivity: 'courseBuilder.categoryProductivity',
  Leadership: 'courseBuilder.categoryLeadership',
};

const difficultyKeys: Record<string, TranslationKey> = {
  Beginner: 'courseBuilder.beginner',
  Intermediate: 'courseBuilder.intermediate',
  Advanced: 'courseBuilder.advanced',
};

const lessonTypeKeys: Record<string, TranslationKey> = {
  Video: 'courseBuilder.typeVideo',
  Reading: 'courseBuilder.typeReading',
  Exercise: 'courseBuilder.typeExercise',
};

export function getCourseCategoryLabel(category: string, t: Translate): string {
  const key = categoryKeys[category];
  return key ? t(key) : category;
}

export function getCourseDifficultyLabel(difficulty: string, t: Translate): string {
  const key = difficultyKeys[difficulty];
  return key ? t(key) : difficulty;
}

export function getLessonTypeLabel(type: string, t: Translate): string {
  const key = lessonTypeKeys[type];
  return key ? t(key) : type;
}