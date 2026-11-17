import { FsError, ROOT, STUDENT, type Inode } from './fs';
import { Shell } from './shell';

export interface Task {
  id: string;
  text: string;
  hint: string;
  check: (shell: Shell) => boolean;
}

export interface Mission {
  id: string;
  title: string;
  intro: string;
  /** Files and directories this mission adds to the base machine (as the student, in $HOME). */
  files: Record<string, string | null>;
  /** Extra setup run as root, e.g. chmod on a file. Plain shell lines. */
  rootSetup?: string[];
  tasks: Task[];
}

// ---- Check helpers ----

const HOME = '/home/student';

function node(shell: Shell, path: string): Inode | null {
  try {
    return shell.fs.lookup(path.startsWith('/') ? path : `${HOME}/${path}`, ROOT);
  } catch (e) {
    if (e instanceof FsError) return null;
    throw e;
  }
}

const isDir = (s: Shell, p: string) => node(s, p)?.type === 'dir';
const isFile = (s: Shell, p: string) => node(s, p)?.type === 'file';
const content = (s: Shell, p: string) => node(s, p)?.content ?? null;
const mode = (s: Shell, p: string) => (node(s, p)?.mode ?? -1) & 0o7777;
const typed = (s: Shell, re: RegExp) => s.log.some((l) => re.test(l.line));
const ran = (s: Shell, re: RegExp, test: (l: Shell['log'][number]) => boolean) =>
  s.log.some((l) => re.test(l.line) && test(l));

// ---- Data used by the missions ----

const SERVER_LOG = [
  '2026-11-16 08:00:01 INFO  login user=lea',
  '2026-11-16 08:02:13 INFO  login user=ali',
  '2026-11-16 08:05:40 ERROR disk /dev/sda1 almost full',
  '2026-11-16 08:07:02 WARN  slow query 2300ms',
  '2026-11-16 08:09:55 INFO  login user=yara',
  '2026-11-16 08:10:12 ERROR failed login user=root',
  '2026-11-16 08:12:44 INFO  login user=lea',
  '2026-11-16 08:15:03 ERROR failed login user=root',
  '2026-11-16 08:20:31 INFO  logout user=ali',
  '2026-11-16 08:21:09 INFO  login user=jad',
  '2026-11-16 08:30:00 WARN  cpu 91%',
  '2026-11-16 08:31:17 ERROR service cron restarted',
  '2026-11-16 08:40:22 INFO  login user=yara',
  '',
].join('\n');

const STUDENTS_CSV = [
  'name,major,grade',
  'Lea,CS,91',
  'Ali,CS,78',
  'Yara,Math,95',
  'Jad,CS,64',
  'Rami,EE,88',
  'Tala,CS,99',
  '',
].join('\n');

export const MISSIONS: Mission[] = [
  {
    id: 'basics',
    title: '1. Find your way around',
    intro: 'Where am I, what is here, and how do I move? pwd, ls and cd.',
    files: {
      Documents: null,
      'Documents/syllabus.txt':
        'CSCI430L Operating Systems Lab\nWeek 1: Linux commands\nWeek 2: Processes and fork()\n',
      Downloads: null,
      'Downloads/lab1.pdf': '%PDF-1.4 (pretend PDF)\n',
      '.secret_note': 'Hidden files start with a dot. You found it!\n',
    },
    tasks: [
      {
        id: 'pwd',
        text: 'Print the directory you are in.',
        hint: 'pwd',
        check: (s) => typed(s, /^\s*pwd\b/),
      },
      {
        id: 'ls-a',
        text: 'List everything in your home directory, including hidden files.',
        hint: 'ls -a  (or ls -la)',
        check: (s) => ran(s, /^\s*ls\b.*-\w*a/, (l) => l.out.includes('.secret_note')),
      },
      {
        id: 'cd-docs',
        text: 'Go into the Documents directory.',
        hint: 'cd Documents',
        check: (s) =>
          typed(s, /^\s*cd\s+(~\/|\/home\/student\/)?Documents\/?\s*$/) ||
          s.cwd === `${HOME}/Documents`,
      },
      {
        id: 'cat',
        text: 'Show the contents of syllabus.txt.',
        hint: 'cat syllabus.txt',
        check: (s) => ran(s, /\b(cat|less|more|head)\b.*syllabus/, (l) => l.out.includes('Week 1')),
      },
      {
        id: 'cd-up',
        text: 'Go back up to your home directory with "..".',
        hint: 'cd ..',
        check: (s) => typed(s, /^\s*cd\s+\.\.\/?\s*$/),
      },
      {
        id: 'abs',
        text: 'List /etc using an absolute path.',
        hint: 'ls /etc',
        check: (s) => ran(s, /^\s*ls\b.*\s\/etc\/?(\s|$)/, (l) => l.out.includes('passwd')),
      },
    ],
  },
  {
    id: 'files',
    title: '2. Files and directories',
    intro: 'Create, copy, move, rename and delete. mkdir, touch, cp, mv, rm.',
    files: {
      'draft.txt': 'Lab report draft\n',
      'old_notes.txt': 'fork() returns 0 in the child.\n',
      junk: null,
      'junk/tmp1': 'x\n',
      'junk/tmp2': 'y\n',
      'junk/more': null,
      'junk/more/tmp3': 'z\n',
    },
    tasks: [
      {
        id: 'mkdir',
        text: 'Create lab1 with two subdirectories, src and docs (one command can do it).',
        hint: 'mkdir -p lab1/src lab1/docs',
        check: (s) => isDir(s, 'lab1/src') && isDir(s, 'lab1/docs'),
      },
      {
        id: 'touch',
        text: 'Create an empty file lab1/src/main.c.',
        hint: 'touch lab1/src/main.c',
        check: (s) => isFile(s, 'lab1/src/main.c'),
      },
      {
        id: 'mv',
        text: 'Move draft.txt into lab1/docs and rename it report.txt.',
        hint: 'mv draft.txt lab1/docs/report.txt',
        check: (s) =>
          content(s, 'lab1/docs/report.txt') === 'Lab report draft\n' && !node(s, 'draft.txt'),
      },
      {
        id: 'cp',
        text: 'Copy old_notes.txt to lab1/docs/notes.txt (keep the original).',
        hint: 'cp old_notes.txt lab1/docs/notes.txt',
        check: (s) =>
          isFile(s, 'old_notes.txt') &&
          content(s, 'lab1/docs/notes.txt') === 'fork() returns 0 in the child.\n',
      },
      {
        id: 'rm',
        text: 'Delete the junk directory and everything inside it.',
        hint: 'rm -r junk   (rmdir only removes empty directories)',
        check: (s) => !node(s, 'junk') && s.log.length > 0,
      },
      {
        id: 'tree',
        text: 'Show the whole lab1 tree.',
        hint: 'tree lab1   (or ls -R lab1)',
        check: (s) => ran(s, /\b(tree|ls\s+-\w*R)\b.*lab1/, (l) => l.out.includes('main.c')),
      },
    ],
  },
  {
    id: 'permissions',
    title: '3. Permissions',
    intro: 'Read, write and execute for owner, group and others. ls -l, chmod, sudo.',
    files: {
      scripts: null,
      'scripts/hello.sh': '#!/bin/bash\necho "Hello from a script, $USER!"\n',
      'secret.txt': 'My exam answers. Nobody else should read this.\n',
      shared: null,
      'shared/plan.txt': 'Group project plan\n',
    },
    tasks: [
      {
        id: 'ls-l',
        text: 'Look at the permissions of the files in scripts.',
        hint: 'ls -l scripts',
        check: (s) => ran(s, /^\s*(ls\s+-\w*l|ll)\b/, (l) => l.out.includes('hello.sh')),
      },
      {
        id: 'run',
        text: 'Make hello.sh executable for its owner, then run it as ./scripts/hello.sh.',
        hint: 'chmod u+x scripts/hello.sh, then ./scripts/hello.sh',
        check: (s) =>
          (mode(s, 'scripts/hello.sh') & 0o100) !== 0 &&
          ran(s, /hello\.sh/, (l) => l.out.includes('Hello from a script')),
      },
      {
        id: 'private',
        text: 'Make secret.txt readable and writable by you only (rw-------).',
        hint: 'chmod 600 secret.txt',
        check: (s) => mode(s, 'secret.txt') === 0o600,
      },
      {
        id: 'group',
        text: 'Give the shared directory rwxr-x--- : you do everything, your group can enter and list it, others nothing.',
        hint: 'chmod 750 shared',
        check: (s) => mode(s, 'shared') === 0o750,
      },
      {
        id: 'shadow',
        text: 'Try to read /etc/shadow. Then read it as root.',
        hint: 'cat /etc/shadow (denied), then sudo cat /etc/shadow',
        check: (s) =>
          ran(s, /^\s*(cat|less|head|tail)\b.*\/etc\/shadow/, (l) =>
            l.err.includes('Permission denied'),
          ) && ran(s, /^\s*sudo\b.*\/etc\/shadow/, (l) => l.out.includes('root:')),
      },
    ],
  },
  {
    id: 'pipes',
    title: '4. Pipes and filters',
    intro: 'Chain small tools with | and save results with >. grep, sort, uniq, wc, cut, head.',
    files: {
      logs: null,
      'logs/server.log': SERVER_LOG,
      'students.csv': STUDENTS_CSV,
    },
    tasks: [
      {
        id: 'grep',
        text: 'Show only the ERROR lines of logs/server.log.',
        hint: 'grep ERROR logs/server.log',
        check: (s) =>
          ran(
            s,
            /\bgrep\b.*ERROR/,
            (l) => (l.out.match(/ERROR/g) ?? []).length === 4 && !l.out.includes('INFO'),
          ),
      },
      {
        id: 'count',
        text: 'Save the number of ERROR lines (just the number) to errors.txt.',
        hint: 'grep ERROR logs/server.log | wc -l > errors.txt   (or grep -c)',
        check: (s) => content(s, 'errors.txt')?.trim() === '4',
      },
      {
        id: 'users',
        text: 'Save the list of users who logged in, sorted, each name once, to users.txt.',
        hint: "grep 'INFO  login' logs/server.log | cut -d= -f2 | sort | uniq > users.txt",
        check: (s) => content(s, 'users.txt')?.trim().split('\n').join(',') === 'ali,jad,lea,yara',
      },
      {
        id: 'top',
        text: 'Save the 3 students with the highest grades (whole lines) to top3.txt, best first.',
        hint: 'sort -t, -k3 -nr students.csv | head -3 > top3.txt',
        check: (s) => {
          const c = content(s, 'top3.txt')
            ?.trim()
            .split('\n')
            .map((l) => l.split(',')[0]);
          return c?.join(',') === 'Tala,Yara,Lea';
        },
      },
      {
        id: 'append',
        text: 'Add the line "checked" to the end of errors.txt without erasing it.',
        hint: 'echo checked >> errors.txt',
        check: (s) => /^4\s*\nchecked\n?$/.test(content(s, 'errors.txt') ?? ''),
      },
    ],
  },
  {
    id: 'processes',
    title: '5. Processes and jobs',
    intro: 'Every command is a process. Run jobs in the background, list them, and stop them.',
    files: {},
    tasks: [
      {
        id: 'bg',
        text: 'Start "sleep 300" in the background.',
        hint: 'sleep 300 &',
        check: (s) => typed(s, /\bsleep\s+300\s*&/),
      },
      {
        id: 'jobs',
        text: "List this shell's background jobs.",
        hint: 'jobs',
        check: (s) => ran(s, /^\s*jobs\b/, (l) => l.out.includes('sleep')),
      },
      {
        id: 'ps-all',
        text: 'List every process on the machine and find the PID of cron.',
        hint: 'ps -ef   (or ps aux)',
        check: (s) => ran(s, /^\s*ps\b/, (l) => l.out.includes('cron')),
      },
      {
        id: 'kill',
        text: 'Stop your sleep with kill.',
        hint: 'kill %1  or  kill <PID from ps>',
        check: (s) =>
          typed(s, /\bsleep\s+300\s*&/) &&
          typed(s, /^\s*kill\b/) &&
          !s.procs.some((p) => p.cmd.startsWith('sleep 300')),
      },
      {
        id: 'denied',
        text: 'Try to kill cron as a normal user. Why is it not allowed?',
        hint: 'kill 412   (cron belongs to root)',
        check: (s) =>
          ran(s, /^\s*kill\b.*\b412\b/, (l) => l.err.includes('Operation not permitted')),
      },
    ],
  },
  {
    id: 'scripting',
    title: '6. Shell scripts',
    intro:
      'Put commands in a file, add #!/bin/bash, make it executable, run it. Variables, $1, for and if.',
    files: {
      'a.txt': 'apple\n',
      'b.txt': 'banana\n',
      'c.txt': 'cherry\ncitrus\n',
    },
    tasks: [
      {
        id: 'greet',
        text: 'Write greet.sh (nano greet.sh) that prints "Hello, " followed by $USER, make it executable and run it.',
        hint: '#!/bin/bash\necho "Hello, $USER"\n…then chmod +x greet.sh and ./greet.sh',
        check: (s) => ran(s, /greet\.sh/, (l) => l.out.includes('Hello, student')),
      },
      {
        id: 'backup',
        text: 'Write backup.sh that copies every .txt file into a backup directory using a for loop, and run it.',
        hint: '#!/bin/bash\nmkdir -p backup\nfor f in *.txt; do\n  cp "$f" backup/\ndone',
        check: (s) =>
          /\bfor\b/.test(content(s, 'backup.sh') ?? '') &&
          ['a.txt', 'b.txt', 'c.txt'].every((f) => isFile(s, `backup/${f}`)),
      },
      {
        id: 'args',
        text: 'Write lines.sh that prints how many lines the file given as $1 has. Run it on c.txt.',
        hint: '#!/bin/bash\nwc -l < "$1"',
        check: (s) => ran(s, /lines\.sh\s+c\.txt/, (l) => l.out.trim().startsWith('2')),
      },
      {
        id: 'if',
        text: 'Write exists.sh that prints "found" if the file $1 exists and "missing" otherwise. Try it on a.txt and nope.txt.',
        hint: '#!/bin/bash\nif [ -f "$1" ]; then\n  echo found\nelse\n  echo missing\nfi',
        check: (s) =>
          ran(s, /exists\.sh\s+a\.txt/, (l) => l.out.trim() === 'found') &&
          ran(s, /exists\.sh\s+nope\.txt/, (l) => l.out.trim() === 'missing'),
      },
    ],
  },
  {
    id: 'sandbox',
    title: 'Free practice',
    intro: 'No tasks: a clean machine to try anything.',
    files: {
      'notes.txt': 'Type help to see every command, or man <command> for one of them.\n',
    },
    tasks: [],
  },
];

export function missionById(id: string): Mission {
  return MISSIONS.find((m) => m.id === id) ?? (MISSIONS[MISSIONS.length - 1] as Mission);
}

/** A fresh machine with the mission's files in place, logged in as student in $HOME. */
export function startMission(mission: Mission): Shell {
  const shell = new Shell();
  for (const [path, data] of Object.entries(mission.files)) {
    const abs = `${HOME}/${path}`;
    if (data === null) shell.fs.create(abs, 'dir', STUDENT, shell.umask);
    else shell.fs.create(abs, 'file', STUDENT, shell.umask, data);
  }
  for (const line of mission.rootSetup ?? []) {
    shell.becomeRoot();
    shell.run(line);
    shell.users.pop();
  }
  shell.cwd = HOME;
  return shell;
}

export function completedTasks(mission: Mission, shell: Shell): Set<string> {
  return new Set(mission.tasks.filter((t) => t.check(shell)).map((t) => t.id));
}
