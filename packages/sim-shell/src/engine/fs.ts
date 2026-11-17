/**
 * An in-memory Unix filesystem with owners, groups and permission bits, enforced the way Linux
 * does: traversing a directory needs x, listing it needs r, creating or deleting inside it needs
 * w and x, and the sticky bit on /tmp protects other users' files. root bypasses r/w checks.
 */

export type NodeType = 'file' | 'dir';

export interface Inode {
  type: NodeType;
  /** Permission bits including setuid/setgid/sticky, e.g. 0o755 or 0o1777. */
  mode: number;
  owner: string;
  group: string;
  /** Virtual clock seconds of the last change. */
  mtime: number;
  content: string;
  children: Map<string, Inode>;
}

export class FsError extends Error {
  constructor(
    readonly code:
      'ENOENT' | 'ENOTDIR' | 'EISDIR' | 'EACCES' | 'EEXIST' | 'ENOTEMPTY' | 'EPERM' | 'EINVAL',
    readonly path: string,
  ) {
    super(code);
  }
}

const MESSAGES: Record<FsError['code'], string> = {
  ENOENT: 'No such file or directory',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  EACCES: 'Permission denied',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  EPERM: 'Operation not permitted',
  EINVAL: 'Invalid argument',
};

export function errorText(e: FsError): string {
  return MESSAGES[e.code];
}

export interface User {
  name: string;
  uid: number;
  groups: string[];
}

export const ROOT: User = { name: 'root', uid: 0, groups: ['root'] };
export const STUDENT: User = { name: 'student', uid: 1000, groups: ['student', 'lab'] };

export type Perm = 'r' | 'w' | 'x';
const BIT: Record<Perm, number> = { r: 4, w: 2, x: 1 };

export function can(node: Inode, user: User, perm: Perm): boolean {
  if (user.uid === 0) {
    // root may read and write anything, but executes a file only if some x bit is set.
    return perm !== 'x' || node.type === 'dir' || (node.mode & 0o111) !== 0;
  }
  const shift = node.owner === user.name ? 6 : user.groups.includes(node.group) ? 3 : 0;
  return ((node.mode >> shift) & BIT[perm]) !== 0;
}

/** "drwxr-xr-x" style string. */
export function modeString(node: Inode): string {
  const m = node.mode;
  const triplet = (shift: number, special: boolean, specialChar: string) => {
    const r = m & (4 << shift) ? 'r' : '-';
    const w = m & (2 << shift) ? 'w' : '-';
    const xOn = (m & (1 << shift)) !== 0;
    const x = special ? (xOn ? specialChar : specialChar.toUpperCase()) : xOn ? 'x' : '-';
    return r + w + x;
  };
  return (
    (node.type === 'dir' ? 'd' : '-') +
    triplet(6, (m & 0o4000) !== 0, 's') +
    triplet(3, (m & 0o2000) !== 0, 's') +
    triplet(0, (m & 0o1000) !== 0, 't')
  );
}

export function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(3, '0');
}

export function splitPath(path: string): string[] {
  return path.split('/').filter((p) => p !== '' && p !== '.');
}

/** Absolute, normalised path from `cwd` and a possibly relative `path` (no symlinks). */
export function resolvePath(cwd: string, path: string): string {
  const parts = path.startsWith('/') ? [] : splitPath(cwd);
  for (const p of splitPath(path)) {
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return `/${parts.join('/')}`;
}

export function dirname(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return `/${parts.join('/')}`;
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '/';
}

export class FileSystem {
  root: Inode;
  /** Virtual clock, advanced by the shell. */
  now = 0;

  constructor() {
    this.root = this.makeNode('dir', 0o755, 'root', 'root');
  }

  makeNode(type: NodeType, mode: number, owner: string, group: string, content = ''): Inode {
    return { type, mode, owner, group, mtime: this.now, content, children: new Map() };
  }

  /** Walks to `path`, checking x on every directory passed through. */
  lookup(path: string, user: User): Inode {
    let node = this.root;
    let at = '';
    for (const part of splitPath(path)) {
      if (node.type !== 'dir') throw new FsError('ENOTDIR', at || '/');
      if (!can(node, user, 'x')) throw new FsError('EACCES', at || '/');
      const next = node.children.get(part);
      at += `/${part}`;
      if (!next) throw new FsError('ENOENT', at);
      node = next;
    }
    return node;
  }

  exists(path: string, user: User): boolean {
    try {
      this.lookup(path, user);
      return true;
    } catch {
      return false;
    }
  }

  /** Parent directory of `path`, checked for w+x so an entry can be created or removed. */
  private writableParent(path: string, user: User): { parent: Inode; name: string } {
    const name = basename(path);
    if (name === '/' || name === '..') throw new FsError('EINVAL', path);
    const parent = this.lookup(dirname(path), user);
    if (parent.type !== 'dir') throw new FsError('ENOTDIR', dirname(path));
    if (!can(parent, user, 'w') || !can(parent, user, 'x')) throw new FsError('EACCES', path);
    return { parent, name };
  }

  /** New file or directory owned by `user`; `umask` clears bits like the real system call. */
  create(path: string, type: NodeType, user: User, umask: number, content = ''): Inode {
    const { parent, name } = this.writableParent(path, user);
    if (parent.children.has(name)) throw new FsError('EEXIST', path);
    const base = type === 'dir' ? 0o777 : 0o666;
    const node = this.makeNode(
      type,
      base & ~umask,
      user.name,
      user.groups[0] ?? user.name,
      content,
    );
    parent.children.set(name, node);
    parent.mtime = this.now;
    return node;
  }

  /** Overwrites (or appends to) a file, creating it if needed. */
  write(path: string, data: string, user: User, umask: number, append = false): void {
    let node: Inode;
    try {
      node = this.lookup(path, user);
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT' && e.path === path) {
        this.create(path, 'file', user, umask, data);
        return;
      }
      throw e;
    }
    if (node.type === 'dir') throw new FsError('EISDIR', path);
    if (!can(node, user, 'w')) throw new FsError('EACCES', path);
    node.content = append ? node.content + data : data;
    node.mtime = this.now;
  }

  read(path: string, user: User): string {
    const node = this.lookup(path, user);
    if (node.type === 'dir') throw new FsError('EISDIR', path);
    if (!can(node, user, 'r')) throw new FsError('EACCES', path);
    return node.content;
  }

  list(path: string, user: User): [string, Inode][] {
    const node = this.lookup(path, user);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', path);
    if (!can(node, user, 'r')) throw new FsError('EACCES', path);
    return [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  remove(path: string, user: User, recursive = false): void {
    const { parent, name } = this.writableParent(path, user);
    const node = parent.children.get(name);
    if (!node) throw new FsError('ENOENT', path);
    // Sticky bit (/tmp): only the file's owner, the directory's owner or root may delete.
    if (
      (parent.mode & 0o1000) !== 0 &&
      user.uid !== 0 &&
      node.owner !== user.name &&
      parent.owner !== user.name
    ) {
      throw new FsError('EPERM', path);
    }
    if (node.type === 'dir' && node.children.size > 0) {
      if (!recursive) throw new FsError('ENOTEMPTY', path);
      if (!can(node, user, 'w') || !can(node, user, 'x')) throw new FsError('EACCES', path);
      for (const child of [...node.children.keys()]) this.remove(`${path}/${child}`, user, true);
    }
    parent.children.delete(name);
    parent.mtime = this.now;
  }

  /** Moves or renames. Like rename(2): needs w+x on both parent directories. */
  move(from: string, to: string, user: User): void {
    const src = this.writableParent(from, user);
    const node = src.parent.children.get(src.name);
    if (!node) throw new FsError('ENOENT', from);
    if (to === from) return;
    if (to.startsWith(`${from}/`)) throw new FsError('EINVAL', to);
    const dst = this.writableParent(to, user);
    const existing = dst.parent.children.get(dst.name);
    if (existing?.type === 'dir' && node.type !== 'dir') throw new FsError('EISDIR', to);
    src.parent.children.delete(src.name);
    dst.parent.children.set(dst.name, node);
    src.parent.mtime = dst.parent.mtime = this.now;
  }

  /** Deep copy owned by `user` (cp does not keep the owner unless root uses -p). */
  copy(from: string, to: string, user: User, umask: number): void {
    const node = this.lookup(from, user);
    if (!can(node, user, 'r')) throw new FsError('EACCES', from);
    if (node.type === 'file') {
      this.write(to, node.content, user, umask);
      const created = this.lookup(to, user);
      if (node.mode & 0o111) created.mode |= node.mode & 0o111 & ~umask;
      return;
    }
    if (!this.exists(to, user)) {
      this.create(to, 'dir', user, umask);
      this.lookup(to, user).mode = node.mode & ~umask;
    }
    if (!can(node, user, 'x')) throw new FsError('EACCES', from);
    for (const [name] of node.children) this.copy(`${from}/${name}`, `${to}/${name}`, user, umask);
  }

  /** Every path below `path` (depth first), for find / ls -R / the file tree. */
  walk(path: string, user: User): { path: string; node: Inode; depth: number }[] {
    const out: { path: string; node: Inode; depth: number }[] = [];
    const rec = (p: string, node: Inode, depth: number) => {
      out.push({ path: p, node, depth });
      if (node.type !== 'dir' || !can(node, user, 'r') || !can(node, user, 'x')) return;
      for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
        rec(p === '/' ? `/${name}` : `${p}/${name}`, child, depth + 1);
      }
    };
    rec(path, this.lookup(path, user), 0);
    return out;
  }
}

/** The machine every session starts from, before a mission adds its own files. */
export function baseFileSystem(): FileSystem {
  const fs = new FileSystem();
  const mk = (path: string, mode: number, owner = 'root', group = owner) => {
    const node = fs.create(path, 'dir', ROOT, 0);
    node.mode = mode;
    node.owner = owner;
    node.group = group;
  };
  const file = (path: string, content: string, mode = 0o644, owner = 'root', group = owner) => {
    const node = fs.create(path, 'file', ROOT, 0, content);
    node.mode = mode;
    node.owner = owner;
    node.group = group;
  };
  mk('/bin', 0o755);
  mk('/etc', 0o755);
  mk('/home', 0o755);
  mk('/home/student', 0o755, 'student');
  mk('/root', 0o700);
  mk('/tmp', 0o1777);
  mk('/usr', 0o755);
  mk('/var', 0o755);
  mk('/var/log', 0o755);
  file('/etc/hostname', 'cslab\n');
  file(
    '/etc/passwd',
    'root:x:0:0:root:/root:/bin/bash\nstudent:x:1000:1000:Student:/home/student:/bin/bash\n',
  );
  file('/etc/group', 'root:x:0:\nstudent:x:1000:\nlab:x:1001:student\n');
  file(
    '/etc/shadow',
    'root:*:19000:0:99999:7:::\nstudent:*:19000:0:99999:7:::\n',
    0o640,
    'root',
    'root',
  );
  file(
    '/etc/os-release',
    'NAME="CS Lab Linux"\nVERSION="1.0"\nID=cslab\nPRETTY_NAME="CS Lab Linux (simulated)"\n',
  );
  file('/home/student/.bashrc', '# ~/.bashrc\nalias ll="ls -l"\n', 0o644, 'student');
  return fs;
}
