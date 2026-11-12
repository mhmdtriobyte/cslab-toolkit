import { Icon } from '@oslab/core';
import { Link, useParams } from 'react-router-dom';
import { APP_NAME, REPO_URL } from './config';
import { examplesFor } from './examples';
import { courses, type Course, type ModuleEntry } from './modules';

function ModuleCard({ m }: { m: ModuleEntry }) {
  return (
    <Link
      to={`/${m.id}`}
      className="flex h-full flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
        <Icon name={m.icon} className="h-6 w-6" />
      </span>
      <span className="text-lg font-semibold text-slate-900 dark:text-white">{m.title}</span>
      <span className="text-sm text-slate-600 dark:text-slate-300">{m.summary}</span>
      <span className="mt-auto flex flex-wrap gap-1 pt-2">
        {m.topics.map((t) => (
          <span
            key={t}
            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {t}
          </span>
        ))}
      </span>
    </Link>
  );
}

function CourseHeading({ course, level }: { course: Course; level: 1 | 2 }) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Tag
        id={`course-${course.id}`}
        className={
          level === 1
            ? 'text-3xl font-bold tracking-tight text-slate-900 dark:text-white'
            : 'text-xl font-semibold text-slate-900 dark:text-white'
        }
      >
        {course.title}
      </Tag>
      {course.code && (
        <span className="rounded bg-indigo-100 px-2 py-0.5 text-sm font-semibold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
          {course.code}
        </span>
      )}
    </div>
  );
}

export function Home() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          {APP_NAME}
        </h1>
        <p className="max-w-3xl text-lg text-slate-600 dark:text-slate-300">
          Open source, interactive tools for computer science courses: operating systems,
          programming in C and Python, data structures and algorithms, and databases. Nothing to
          install, no account: everything runs in your browser.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every tool has an <strong>Examples</strong> menu and a <strong>Share link</strong> button,
          so an exercise can be handed out as a single URL. Turn on <strong>Presentation</strong>{' '}
          mode on a projector.
        </p>
      </section>

      {courses.map((course) => (
        <section
          key={course.id}
          aria-labelledby={`course-${course.id}`}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CourseHeading course={course} level={2} />
              <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-300">{course.blurb}</p>
            </div>
            <Link
              to={`/course/${course.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              Course page and examples
              <Icon name="arrowRight" />
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {course.modules.map((m) => (
              <li key={m.id}>
                <ModuleCard m={m} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="text-sm text-slate-600 dark:text-slate-400">
        Found a bug or want to add an exercise?{' '}
        <a href={REPO_URL} className="text-indigo-700 underline dark:text-indigo-300">
          Contribute on GitHub
        </a>
        . Examples are plain JSON files, no code needed.
      </section>
    </div>
  );
}

export function CoursePage() {
  const { courseId } = useParams();
  const course = courses.find((c) => c.id === courseId);
  if (!course) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <h1 className="text-2xl font-bold">Course not found</h1>
        <Link to="/" className="mt-4 inline-block text-indigo-600 underline dark:text-indigo-400">
          Back to all courses
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 py-4">
      <section className="flex flex-col gap-2">
        <CourseHeading course={course} level={1} />
        <p className="max-w-3xl text-lg text-slate-600 dark:text-slate-300">{course.blurb}</p>
      </section>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {course.modules.map((m) => (
          <li key={m.id}>
            <ModuleCard m={m} />
          </li>
        ))}
      </ul>
      <section aria-labelledby="examples-heading" className="flex flex-col gap-3">
        <h2 id="examples-heading" className="text-xl font-semibold">
          Examples
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {course.modules.map((m) => {
            const examples = examplesFor(m.id);
            if (examples.length === 0) return null;
            return (
              <div
                key={m.id}
                className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              >
                <h3 className="mb-2 font-semibold">{m.title}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {examples.map((ex) => (
                    <li key={ex.id}>
                      <Link
                        to={`/${m.id}#ex=${encodeURIComponent(ex.id)}`}
                        className="text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
                      >
                        {ex.title}
                      </Link>
                      {ex.description && (
                        <span className="text-slate-500 dark:text-slate-400">
                          {' '}
                          · {ex.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
