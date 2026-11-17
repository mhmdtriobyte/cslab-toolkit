import { describe, expect, it } from 'vitest';
import {
  applyChmod,
  completedTasks,
  missionById,
  MISSIONS,
  modeString,
  parse,
  Shell,
  startMission,
} from '.';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

function sh(missionId = 'sandbox') {
  const shell = startMission(missionById(missionId));
  const run = (line: string) => {
    const r = shell.replay(line);
    return { out: strip(r.out), err: r.err, code: r.code };
  };
  return { shell, run };
}

describe('parser', () => {
  it('handles quotes, pipes, redirects and lists', () => {
    const items = parse(`echo "a b" 'c|d' | grep a > out.txt && ls; sleep 5 &`);
    expect(items.map((i) => i.op)).toEqual(['&&', ';', '&']);
    expect(items[0]?.pipeline).toHaveLength(2);
    expect(items[0]?.pipeline[1]?.redirects[0]?.op).toBe('>');
  });

  it('reports syntax errors like bash', () => {
    expect(() => parse('ls |')).toThrow(/unexpected end/);
    expect(() => parse('| ls')).toThrow(/unexpected token/);
    expect(() => parse('echo "open')).toThrow(/missing "/);
  });
});

describe('files and navigation', () => {
  it('pwd, cd, mkdir -p, touch, ls', () => {
    const { run, shell } = sh();
    expect(run('pwd').out).toBe('/home/student\n');
    expect(run('mkdir -p a/b/c && cd a/b && pwd').out).toBe('/home/student/a/b\n');
    run('touch x.txt y.txt');
    expect(run('ls').out).toBe('c\nx.txt\ny.txt\n'.replace(/\n/g, '  ').trim() + '\n');
    run('cd -');
    expect(shell.cwd).toBe('/home/student');
    expect(run('cd nope').err).toBe('bash: cd: nope: No such file or directory\n');
    run('cd ~/a/b/../..');
    expect(shell.cwd).toBe('/home/student');
  });

  it('ls -l shows modes, owners and sizes', () => {
    const { run } = sh();
    run('echo hello > f.txt');
    const line = run('ls -l f.txt').out.trim();
    expect(line).toMatch(/^-rw-r--r-- 1 student student 6 Nov 17 09:0\d f\.txt$/);
    expect(run('ls -a').out).toContain('.bashrc');
    expect(run('ls').out).not.toContain('.bashrc');
  });

  it('cp, mv, rm with and without -r', () => {
    const { run, shell } = sh('files');
    expect(run('rm junk').err).toContain('Is a directory');
    expect(run('rmdir junk').err).toContain('Directory not empty');
    run('rm -r junk');
    expect(shell.fs.exists('/home/student/junk', shell.user)).toBe(false);
    run('mkdir d');
    run('cp draft.txt old_notes.txt d');
    run('mv d/draft.txt d/report.txt');
    expect(run('ls d').out.trim().split(/\s+/)).toEqual(['old_notes.txt', 'report.txt']);
    expect(run('cp d e').err).toContain('-r not specified');
    run('cp -r d e');
    expect(run('cat e/report.txt').out).toBe('Lab report draft\n');
    expect(run('rm -f missing').code).toBe(0);
  });

  it('globs, variables, $(...), ~ and quoting', () => {
    const { run } = sh('scripting');
    expect(run('echo *.txt').out).toBe('a.txt b.txt c.txt\n');
    expect(run('echo \'*.txt\' "$HOME"').out).toBe('*.txt /home/student\n');
    expect(run('echo ~ ~/x').out).toBe('/home/student /home/student/x\n');
    run('NAME=Lea');
    expect(run('echo "Hi $NAME, today is $(date +%Y-%m-%d)"').out).toBe(
      'Hi Lea, today is 2026-11-17\n',
    );
    expect(run('echo nothing*here').out).toBe('nothing*here\n');
    expect(run('X="a  b"; echo $X; echo "$X"').out).toBe('a b\na  b\n');
    expect(run('false; echo $?').out).toBe('1\n');
  });
});

describe('pipes and redirection', () => {
  it('pipes filters together and writes files', () => {
    const { run } = sh('pipes');
    expect(run('grep -c ERROR logs/server.log').out).toBe('4\n');
    expect(run('grep ERROR logs/server.log | wc -l').out).toBe('4\n');
    run("grep 'INFO  login' logs/server.log | cut -d= -f2 | sort | uniq > users.txt");
    expect(run('cat users.txt').out).toBe('ali\njad\nlea\nyara\n');
    expect(run('sort -t, -k3 -nr students.csv | head -3').out).toBe(
      'Tala,CS,99\nYara,Math,95\nLea,CS,91\n',
    );
    run('echo one > f; echo two >> f');
    expect(run('cat f').out).toBe('one\ntwo\n');
    expect(run('cat nope 2> err.txt').err).toBe('');
    expect(run('cat err.txt').out).toBe('cat: nope: No such file or directory\n');
    expect(run('wc -l < students.csv').out).toBe('7\n');
    expect(run("echo hello | tr 'a-z' 'A-Z'").out).toBe('HELLO\n');
    expect(run('cut -d, -f1 students.csv | sort | uniq -c | head -2').out).toBe(
      '      1 Ali\n      1 Jad\n',
    );
  });

  it('&& and || short-circuit', () => {
    const { run } = sh();
    expect(run('false && echo no || echo yes').out).toBe('yes\n');
    expect(run('true && echo a; echo b').out).toBe('a\nb\n');
  });
});

describe('permissions', () => {
  it('modes print and chmod parses octal and symbolic forms', () => {
    expect(applyChmod(0o644, 'u+x', false)).toBe(0o744);
    expect(applyChmod(0o777, 'go-w', false)).toBe(0o755);
    expect(applyChmod(0o644, '+x', false, 0o022)).toBe(0o755);
    expect(applyChmod(0o777, 'o=r,g=rx', false)).toBe(0o754);
    expect(applyChmod(0o644, '700', false)).toBe(0o700);
    expect(applyChmod(0o644, 'u+q', false)).toBeNull();
    expect(modeString({ type: 'dir', mode: 0o1777 } as never)).toBe('drwxrwxrwt');
    expect(modeString({ type: 'file', mode: 0o4755 } as never)).toBe('-rwsr-xr-x');
  });

  it('enforces read, write and execute bits', () => {
    const { run } = sh('permissions');
    expect(run('./scripts/hello.sh').err).toBe('bash: ./scripts/hello.sh: Permission denied\n');
    expect(run('bash scripts/hello.sh').out).toBe('Hello from a script, student!\n');
    run('chmod u+x scripts/hello.sh');
    expect(run('./scripts/hello.sh').out).toBe('Hello from a script, student!\n');
    run('chmod 000 secret.txt');
    expect(run('cat secret.txt').err).toBe('cat: secret.txt: Permission denied\n');
    expect(run('echo x > secret.txt').err).toContain('Permission denied');
    run('chmod 600 secret.txt');
    expect(run('cat secret.txt').code).toBe(0);
    run('chmod 644 shared; chmod a-x shared');
    expect(run('cd shared').err).toContain('Permission denied');
    expect(run('cat /etc/shadow').err).toContain('Permission denied');
    expect(run('sudo cat /etc/shadow').out).toContain('root:');
    expect(run('chmod 777 /etc/passwd').err).toContain('Operation not permitted');
    expect(run('touch /root/x').err).toContain('Permission denied');
  });

  it('sticky /tmp protects other users files; sudo -i and exit', () => {
    const { run, shell } = sh();
    run('sudo touch /tmp/rootfile');
    expect(run('rm /tmp/rootfile').err).toContain('Operation not permitted');
    run('touch /tmp/mine && rm /tmp/mine');
    run('sudo -i');
    expect(shell.prompt()).toBe('root@cslab:~# ');
    expect(run('whoami').out).toBe('root\n');
    run('exit');
    expect(run('whoami').out).toBe('student\n');
  });

  it('umask changes new file modes', () => {
    const { run } = sh();
    run('umask 077; touch p; mkdir q');
    expect(run('ls -l').out).toMatch(/-rw------- .* p\n/);
    expect(run('ls -l').out).toMatch(/drwx------ .* q\n/);
  });
});

describe('processes', () => {
  it('background jobs, ps, kill and the virtual clock', () => {
    const { run, shell } = sh();
    expect(run('sleep 30 &').out).toBe('[1] 2401\n');
    expect(run('jobs').out).toContain('sleep 30 &');
    expect(run('ps').out).toContain('sleep');
    expect(run('ps -ef').out).toContain('/usr/sbin/cron');
    expect(run('kill 412').err).toContain('Operation not permitted');
    run('kill %1');
    expect(shell.takeNotices().join()).toContain('Terminated');
    run('sleep 5 &');
    run('sleep 10');
    expect(shell.takeNotices().join()).toContain('Done');
    expect(run('jobs').out).toBe('');
  });
});

describe('scripts and control flow', () => {
  it('runs for, if and while with arguments', () => {
    const { run } = sh('scripting');
    run("echo '#!/bin/bash' > loop.sh");
    run('echo \'for f in *.txt; do echo "$1: $f"; done\' >> loop.sh');
    run('chmod +x loop.sh');
    expect(run('./loop.sh file').out).toBe('file: a.txt\nfile: b.txt\nfile: c.txt\n');
    expect(run('for i in 1 2 3; do echo $i; done').out).toBe('1\n2\n3\n');
    expect(run('if [ -f a.txt ]; then echo yes; else echo no; fi').out).toBe('yes\n');
    expect(run('if [ -d a.txt ]; then echo yes; elif [ 2 -gt 1 ]; then echo two; fi').out).toBe(
      'two\n',
    );
    expect(run('n=0; while [ $n -lt 3 ]; do echo n$n; n=$((n + 1)); done').out).toBe(
      'n0\nn1\nn2\n',
    );
    expect(run('echo $(( (2 + 3) * 4 % 7 )) $((10 / 3)) $((2 ** 5))').out).toBe('6 3 32\n');
    expect(run('echo $((1 / 0))').err).toContain('division by 0');
    expect(run('while true; do echo; done').err).toContain('infinite loop');
    expect(run('if true; then echo x').err).toContain("missing 'fi'");
  });
});

describe('missions', () => {
  it('every mission sets up and the hints solve every task', () => {
    const solutions: Record<string, string[]> = {
      basics: ['pwd', 'ls -a', 'cd Documents', 'cat syllabus.txt', 'cd ..', 'ls /etc'],
      files: [
        'mkdir -p lab1/src lab1/docs',
        'touch lab1/src/main.c',
        'mv draft.txt lab1/docs/report.txt',
        'cp old_notes.txt lab1/docs/notes.txt',
        'rm -r junk',
        'tree lab1',
      ],
      permissions: [
        'ls -l scripts',
        'chmod u+x scripts/hello.sh',
        './scripts/hello.sh',
        'chmod 600 secret.txt',
        'chmod 750 shared',
        'cat /etc/shadow',
        'sudo cat /etc/shadow',
      ],
      pipes: [
        'grep ERROR logs/server.log',
        'grep ERROR logs/server.log | wc -l > errors.txt',
        "grep 'INFO  login' logs/server.log | cut -d= -f2 | sort | uniq > users.txt",
        'sort -t, -k3 -nr students.csv | head -3 > top3.txt',
        'echo checked >> errors.txt',
      ],
      processes: ['sleep 300 &', 'jobs', 'ps -ef', 'kill %1', 'kill 412'],
      scripting: [
        'echo \'echo "Hello, $USER"\' > greet.sh',
        'chmod +x greet.sh',
        './greet.sh',
        'printf \'mkdir -p backup\\nfor f in *.txt; do\\n  cp "$f" backup/\\ndone\\n\' > backup.sh',
        'bash backup.sh',
        'echo \'wc -l < "$1"\' > lines.sh',
        'bash lines.sh c.txt',
        'printf \'if [ -f "$1" ]; then\\n  echo found\\nelse\\n  echo missing\\nfi\\n\' > exists.sh',
        'bash exists.sh a.txt',
        'bash exists.sh nope.txt',
      ],
      sandbox: [],
    };
    for (const m of MISSIONS) {
      const { shell, run } = sh(m.id);
      expect(completedTasks(m, shell).size, `${m.id} starts with nothing done`).toBe(0);
      const done = new Set<string>();
      for (const line of solutions[m.id] ?? []) {
        run(line);
        for (const t of completedTasks(m, shell)) done.add(t);
      }
      expect([...done].sort(), m.id).toEqual(m.tasks.map((t) => t.id).sort());
    }
  });

  it('editor saves are replayable history entries', () => {
    const shell = new Shell();
    shell.replay('nano notes.txt');
    expect(shell.effects.editor).toMatchObject({
      path: '/home/student/notes.txt',
      content: '',
      writable: true,
    });
    shell.replay({ path: 'notes.txt', content: 'hi\n' });
    expect(strip(shell.replay('cat notes.txt').out)).toBe('hi\n');
  });
});

describe('tab completion', () => {
  it('completes commands and paths like bash', async () => {
    const { complete } = await import('./complete');
    const { shell } = sh('basics');
    expect(complete(shell, 'pw')).toEqual({ line: 'pwd ', options: [] });
    expect(complete(shell, 'cd Doc')).toEqual({ line: 'cd Documents/', options: [] });
    expect(complete(shell, 'cat Documents/s')).toEqual({
      line: 'cat Documents/syllabus.txt ',
      options: [],
    });
    expect(complete(shell, 'ls D')).toEqual({ line: 'ls Do', options: [] });
    expect(complete(shell, 'ls Do')).toEqual({
      line: 'ls Do',
      options: ['Documents/', 'Downloads/'],
    });
    expect(complete(shell, 'ls .sec')).toEqual({ line: 'ls .secret_note ', options: [] });
    expect(complete(shell, 'cat /etc/pa')).toEqual({ line: 'cat /etc/passwd ', options: [] });
  });
});

describe('shell presets', () => {
  const presets = import.meta.glob<{ id: string; input: { mission: string; history: string[] } }>(
    '../../../../examples/shell/*.json',
    { eager: true, import: 'default' },
  );
  it.each(Object.entries(presets))('%s replays without errors', (path, p) => {
    expect(path.endsWith(`/${p.id}.json`)).toBe(true);
    const { run } = sh(p.input.mission);
    const results = p.input.history.map((line) => run(line));
    const expectedFailures = p.id === 'permission-denied' ? 1 : 0;
    expect(results.filter((r) => r.code !== 0).length, JSON.stringify(results)).toBe(
      expectedFailures,
    );
  });
});
