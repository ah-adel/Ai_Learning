import { ArrowRight, BookOpenText, Bot, BrainCircuit, Check, ShieldCheck, Sparkles, Stars, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation, type TranslationKey } from '@/context/I18nContext';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';

const features: { icon: typeof BookOpenText; titleKey: TranslationKey; descriptionKey: TranslationKey }[] = [
  {
    icon: BookOpenText,
    titleKey: 'landing.structuredPaths',
    descriptionKey: 'landing.structuredPathsDescription',
  },
  {
    icon: BrainCircuit,
    titleKey: 'landing.aiTutorGuidance',
    descriptionKey: 'landing.aiTutorGuidanceDescription',
  },
  {
    icon: ShieldCheck,
    titleKey: 'landing.roleManagement',
    descriptionKey: 'landing.roleManagementDescription',
  },
];

const supportedModels = [
  'GPT-4o Mini',
  'Claude 3.5 Sonnet',
  'Gemini 2.0 Flash',
];

const stats: { value: string; labelKey: TranslationKey }[] = [
  { value: '12k+', labelKey: 'landing.activeLearners' },
  { value: '96%', labelKey: 'landing.completionRate' },
  { value: '4.9/5', labelKey: 'landing.satisfaction' },
];

export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-white">
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/75">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-600 to-violet-600 text-lg font-bold text-white shadow-lg shadow-primary-500/20">
              L
            </div>
            <div>
              <div className="text-base font-semibold tracking-tight">LearnFlow AI</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                {t('landing.learningPlatform')}
              </div>
            </div>
          </Link>

          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <LanguageToggle className="shrink-0" />
            <ThemeToggle />
            <Link to="/auth/sign-in" className="btn-secondary">
              {t('landing.signIn')}
            </Link>
            <Link to="/auth/sign-up" className="btn-primary">
              {t('landing.signUp')}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(168,85,247,0.12),_transparent_25%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:px-8 lg:py-24">
            <div className="flex flex-col justify-center">
              <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary-700 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-300">
                <Sparkles className="h-3.5 w-3.5" />
                {t('landing.aiPowered')}
              </div>

              <h1 className="max-w-xl text-4xl font-black tracking-tight text-gray-950 dark:text-white sm:text-5xl lg:text-6xl">
                {t('landing.headline')}
              </h1>

              <p className="mt-6 max-w-xl text-lg text-gray-600 dark:text-gray-300">
                {t('landing.description')}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/auth/sign-up" className="btn-primary">
                  {t('landing.startLearning')}
                  <ArrowRight className="directional-icon h-4 w-4" />
                </Link>
                <Link to="/auth/sign-in" className="btn-secondary">
                  {t('landing.existingAccount')}
                </Link>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {stats.map((stat) => (
                  <div key={stat.labelKey} className="rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t(stat.labelKey)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-8 top-10 h-24 w-24 rounded-full bg-primary-400/20 blur-3xl dark:bg-primary-500/20" />
              <div className="absolute -right-4 bottom-0 h-28 w-28 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/20" />

              <div className="relative overflow-hidden rounded-[28px] border border-gray-200 bg-white p-4 shadow-[0_30px_80px_rgba(15,23,42,0.12)] dark:border-gray-800 dark:bg-gray-950">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                        {t('landing.learningDashboard')}
                      </p>
                      <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{t('landing.aiCoachOverview')}</h2>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                      <Bot className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="rounded-2xl bg-gradient-to-r from-primary-600 to-violet-600 p-4 text-white shadow-lg shadow-primary-500/20">
                      <div className="flex items-center justify-between text-sm text-primary-50">
                        <span>{t('landing.learningMomentum')}</span>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">+18%</span>
                      </div>
                      <div className="mt-4 text-3xl font-bold">84%</div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/20">
                        <div className="h-full w-[84%] rounded-full bg-white" />
                      </div>
                    </div>

                    <div className="space-y-3">
                      {([
                        { labelKey: 'landing.courseProgress', value: '72%' },
                        { labelKey: 'landing.tutorResponses', value: `31 ${t('landing.today')}` },
                        { labelKey: 'landing.nextMilestone', value: t('landing.uxSprint') },
                      ] as { labelKey: TranslationKey; value: string }[]).map((row) => (
                        <div key={row.labelKey} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950">
                          <span className="text-sm text-gray-600 dark:text-gray-300">{t(row.labelKey)}</span>
                          <span className="font-semibold text-gray-900 dark:text-white">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">{t('landing.whyTeams')}</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
              {t('landing.everythingNeeded')}
            </h2>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {features.map(({ icon: Icon, titleKey, descriptionKey }) => (
              <div key={titleKey} className="card p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-gray-900 dark:text-white">{t(titleKey)}</h3>
                <p className="mt-3 text-gray-600 dark:text-gray-300">{t(descriptionKey)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-gray-200 bg-white/70 dark:border-gray-800 dark:bg-gray-950/40">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 dark:text-primary-300">
                  {t('landing.supportedModels')}
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {t('landing.modelOrchestration')}
                </h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
                <Stars className="h-4 w-4" />
                {t('landing.multiModelReady')}
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[...supportedModels, t('landing.customRouting')].map((model) => (
                <div key={model} className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-primary-600 shadow-sm dark:bg-gray-950 dark:text-primary-300">
                      <Zap className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                      {t('landing.active')}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-gray-900 dark:text-white">{model}</h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    {t('landing.modelDescription')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="rounded-[28px] border border-primary-200 bg-gradient-to-br from-primary-600 via-violet-600 to-primary-700 p-8 text-white shadow-2xl shadow-primary-500/20 sm:p-10 lg:p-12">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary-100">{t('landing.readyToGrow')}</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  {t('landing.launchExperience')}
                </h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/auth/sign-up" className="btn-primary bg-white text-primary-700 hover:bg-gray-100 dark:bg-white dark:text-primary-700">
                  {t('landing.createAccount')}
                </Link>
                <Link to="/auth/sign-in" className="btn-secondary border-white/30 bg-white/10 text-white hover:bg-white/15 dark:border-white/30 dark:bg-white/10 dark:text-white">
                  {t('landing.signIn')}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-gray-500 dark:text-gray-400 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200">
            <Check className="h-4 w-4 text-emerald-500" />
            LearnFlow AI
          </div>
          <div>{t('landing.designedForTeams')}</div>
        </div>
      </footer>
    </div>
  );
}
