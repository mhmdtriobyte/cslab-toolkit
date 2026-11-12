import type { Language } from '../engine/protocol';

export interface RunnerInput {
  language: Language;
  python: string;
  c: string;
  /** Standard input, one box per language so switching tabs keeps each example working. */
  pythonStdin: string;
  cStdin: string;
}

export const DEFAULT_PYTHON = `def average(marks):
    total = 0
    for m in marks:
        total += m
    return total / len(marks)

name = input("Your name: ")
marks = [int(x) for x in input("Marks: ").split()]
print(f"{name}, your average is {average(marks):.1f}")
`;

export const DEFAULT_C = `#include <stdio.h>

int sum(const int a[], int n) {
    int total = 0;
    for (int i = 0; i < n; i++)
        total += a[i];
    return total;
}

int main(void) {
    int n;
    printf("How many numbers? ");
    scanf("%d", &n);
    int a[10];
    for (int i = 0; i < n && i < 10; i++)
        scanf("%d", &a[i]);
    printf("\\nSum = %d\\n", sum(a, n < 10 ? n : 10));
    return 0;
}
`;

export const DEFAULT_INPUT: RunnerInput = {
  language: 'python',
  python: DEFAULT_PYTHON,
  c: DEFAULT_C,
  pythonStdin: 'Lea\n85 92 78\n',
  cStdin: '4\n10 20 30 40\n',
};

const MAX = 50_000;

export function sanitizeInput(raw: unknown): RunnerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    language: r.language === 'c' ? 'c' : 'python',
    python: typeof r.python === 'string' ? r.python.slice(0, MAX) : DEFAULT_PYTHON,
    c: typeof r.c === 'string' ? r.c.slice(0, MAX) : DEFAULT_C,
    pythonStdin:
      typeof r.pythonStdin === 'string'
        ? r.pythonStdin.slice(0, 10_000)
        : DEFAULT_INPUT.pythonStdin,
    cStdin: typeof r.cStdin === 'string' ? r.cStdin.slice(0, 10_000) : DEFAULT_INPUT.cStdin,
  };
}
