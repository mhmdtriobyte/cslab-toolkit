import { Suspense, useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { cx, Icon, useTheme } from '@oslab/core';
import { APP_NAME, REPO_URL } from './config';
import { examplesFor } from './examples';
import { CoursePage, Home } from './Home';
import { courseOf, courses, modules } from './modules';

const toolbarButton =
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

function Header() {
  const { theme, setTheme, presentation, setPresentation } = useTheme();
  const current = courseOf(useLocation().pathname.slice(1));
  return (
    <header className="z-20 border-b md:sticky md:top-0 border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <Link to="/" className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          {APP_NAME}
        </Link>
        <nav aria-label="Courses" className="flex flex-wrap gap-1">
          {courses.map((c) => (
            <NavLink
              key={c.id}
              to={`/course/${c.id}`}
              className={({ isActive }) =>
                cx(
                  'rounded-md px-2 py-1 text-sm',
                  isActive || current?.id === c.id
                    ? 'bg-indigo-100 font-semibold text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              {c.short}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPresentation(!presentation)}
            aria-pressed={presentation}
            className={cx(
              toolbarButton,
              presentation && 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500',
            )}
            title="Bigger text and contrast for projectors"
          >
            Presentation
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={toolbarButton}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={toolbarButton}
            aria-label="Source code on GitHub"
          >
            <Icon name="github" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-indigo-600 underline dark:text-indigo-400">
        Back to all modules
      </Link>
    </div>
  );
}

/** "Operating Systems › Fork visualizer" above every tool, and the browser tab title. */
function Breadcrumb({ moduleId }: { moduleId: string }) {
  const course = courseOf(moduleId);
  const module = modules.find((m) => m.id === moduleId);
  useEffect(() => {
    document.title = module ? `${module.title} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [module]);
  if (!course || !module) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-500 dark:text-slate-400">
      <Link to={`/course/${course.id}`} className="hover:underline">
        {course.title}
        {course.code ? ` (${course.code})` : ''}
      </Link>
      <span aria-hidden> › </span>
      <span aria-current="page" className="text-slate-700 dark:text-slate-200">
        {module.title}
      </span>
    </nav>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">
        <Suspense fallback={<p className="p-8 text-center text-slate-500">Loading module…</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/course/:courseId" element={<CoursePage />} />
            {modules.map(({ id, Component }) => (
              <Route
                key={id}
                path={`/${id}`}
                element={
                  <>
                    <Breadcrumb moduleId={id} />
                    <Component examples={examplesFor(id)} />
                  </>
                }
              />
            ))}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        {APP_NAME}, open source teaching tools · MIT License · Everything runs in your browser.
      </footer>
    </div>
  );
}
