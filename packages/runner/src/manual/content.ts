import type { Language } from '../engine/protocol';

/** One runnable example in the manual. */
export interface Snippet {
  code: string;
  /** What the program reads from standard input, if anything. */
  stdin?: string;
}

export interface Entry {
  /** One-line summary under the topic title. */
  intro: string;
  /** Short bullet points: the rules worth remembering. */
  notes: string[];
  example: Snippet;
}

export interface Topic {
  id: string;
  title: string;
  python: Entry;
  c: Entry;
}

export const TOPICS: Topic[] = [
  {
    id: 'hello',
    title: 'Program structure',
    python: {
      intro:
        'A Python file runs from top to bottom. There is no main function unless you write one.',
      notes: [
        'Indentation (4 spaces) is part of the syntax: it marks blocks.',
        '# starts a comment. No semicolons at the end of lines.',
        'Defining main() and calling it at the bottom is a common convention.',
      ],
      example: {
        code: `# Comments start with #
def main():
    print("Hello, world!")

main()
`,
      },
    },
    c: {
      intro: 'Every C program starts in main(). Libraries are added with #include.',
      notes: [
        'Statements end with ; and blocks use { }. Indentation is only for humans.',
        '// line comment and /* block comment */.',
        'main returns 0 to tell the system the program succeeded.',
      ],
      example: {
        code: `#include <stdio.h>   /* printf lives here */

// Execution starts in main
int main(void) {
    printf("Hello, world!\\n");
    return 0;
}
`,
      },
    },
  },
  {
    id: 'variables',
    title: 'Variables and types',
    python: {
      intro:
        'Variables are created by assigning to them. The type belongs to the value, not the name.',
      notes: [
        'Main types: int, float, str, bool (True / False), None.',
        'type(x) tells you the type; int("5"), float("2.5"), str(7) convert.',
        'Integers never overflow: 2 ** 100 just works.',
      ],
      example: {
        code: `age = 20
gpa = 3.75
name = "Lea"
passed = True
nothing = None

print(type(age), type(gpa), type(name), type(passed), type(nothing))
print(int("42") + 1, float("2.5") * 2, str(7) + "7")
print(2 ** 100)
`,
      },
    },
    c: {
      intro: 'Every variable must be declared with a type before it is used.',
      notes: [
        'int (whole numbers), double (decimals), char (one character), and more.',
        'An uninitialised local variable holds garbage: always give it a value.',
        'Integer division drops the fraction: 7 / 2 is 3. Use 7.0 / 2 for 3.5.',
        'const makes a variable read-only. sizeof(x) gives its size in bytes.',
      ],
      example: {
        code: `#include <stdio.h>

int main(void) {
    int age = 20;
    double gpa = 3.75;
    char grade = 'A';
    const int MAX = 100;

    printf("%d %.2f %c %d\\n", age, gpa, grade, MAX);
    printf("7 / 2 = %d, 7.0 / 2 = %.1f\\n", 7 / 2, 7.0 / 2);
    printf("sizeof: int %zu, double %zu, char %zu\\n", sizeof(int), sizeof(double), sizeof(char));
    return 0;
}
`,
      },
    },
  },
  {
    id: 'io',
    title: 'Input and output',
    python: {
      intro: 'print() writes a line; input() reads one line as a string.',
      notes: [
        'input() always returns str: convert with int() or float().',
        'f-strings format values: f"{x:.2f}" gives 2 decimals.',
        'print(a, b, sep=", ", end="") changes the separator and line ending.',
        'Several numbers on one line: map(int, input().split()).',
      ],
      example: {
        code: `name = input("Name: ")
age = int(input("Age: "))
a, b = map(int, input("Two numbers: ").split())

print(f"Hi {name}, next year you will be {age + 1}.")
print(f"{a} / {b} = {a / b:.3f}")
print("no newline here", end="")
print(" ... continued")
`,
        stdin: 'Lea\n20\n7 3\n',
      },
    },
    c: {
      intro: 'printf writes formatted text; scanf reads values into variables (note the &).',
      notes: [
        'Formats: %d int, %f double in printf, %lf double in scanf, %c char, %s string.',
        'scanf needs the address of the variable: &x. Arrays (strings) are already addresses.',
        'scanf returns how many values it read: check it to detect bad input.',
        '%.2f prints 2 decimals, %5d pads to width 5.',
      ],
      example: {
        code: `#include <stdio.h>

int main(void) {
    char name[20];
    int age;
    double height;

    printf("Name, age and height: ");
    if (scanf("%19s %d %lf", name, &age, &height) != 3) {
        printf("Bad input\\n");
        return 1;
    }
    printf("\\n%s is %d and %.2f m tall\\n", name, age, height);
    printf("[%5d] [%-5d]\\n", age, age);
    return 0;
}
`,
        stdin: 'Lea 20 1.68\n',
      },
    },
  },
  {
    id: 'operators',
    title: 'Operators',
    python: {
      intro: 'Arithmetic, comparison and logical operators.',
      notes: [
        '/ always gives a float; // is floor division; % is remainder; ** is power.',
        'Logical operators are words: and, or, not.',
        'Comparisons chain: 0 < x < 10.',
        'x += 1 works, but there is no x++.',
      ],
      example: {
        code: `a, b = 17, 5
print(a / b, a // b, a % b, a ** 2)
x = 7
print(0 < x < 10, x == 7 and x != 8, not x > 3)
x += 1
print(x)
`,
      },
    },
    c: {
      intro: 'Arithmetic, comparison, logical and increment operators.',
      notes: [
        '/ between two ints is integer division; % is remainder (ints only).',
        'Logical: && (and), || (or), ! (not). They short-circuit.',
        'x++ and ++x both add 1; they differ only in the value the expression gives.',
        '= assigns, == compares. if (x = 5) is a classic bug.',
      ],
      example: {
        code: `#include <stdio.h>

int main(void) {
    int a = 17, b = 5;
    printf("%d %d %.2f\\n", a / b, a % b, (double)a / b);

    int x = 7;
    printf("%d %d %d\\n", x > 3 && x < 10, x == 7 || x == 8, !(x > 3));

    int y = x++;   /* y gets 7, then x becomes 8 */
    int z = ++x;   /* x becomes 9, then z gets 9 */
    printf("x=%d y=%d z=%d\\n", x, y, z);
    return 0;
}
`,
      },
    },
  },
  {
    id: 'conditions',
    title: 'Conditions',
    python: {
      intro: 'if / elif / else, chosen by indentation.',
      notes: [
        'Empty values are false: 0, "", [], {}, None.',
        'One-line conditional: value_if_true if condition else value_if_false.',
        'match / case (Python 3.10+) compares a value against patterns.',
      ],
      example: {
        code: `mark = int(input())
if mark >= 90:
    grade = "A"
elif mark >= 80:
    grade = "B"
elif mark >= 60:
    grade = "C"
else:
    grade = "F"
print(grade, "pass" if mark >= 60 else "fail")

match grade:
    case "A" | "B":
        print("Great")
    case _:
        print("Keep going")
`,
        stdin: '84\n',
      },
    },
    c: {
      intro: 'if / else if / else, and switch for choosing between constant values.',
      notes: [
        'Any non-zero value is true; 0 is false.',
        'In a switch, forgetting break falls through to the next case.',
        'Ternary operator: cond ? a : b.',
      ],
      example: {
        code: `#include <stdio.h>

int main(void) {
    int mark;
    scanf("%d", &mark);

    char grade;
    if (mark >= 90)
        grade = 'A';
    else if (mark >= 80)
        grade = 'B';
    else if (mark >= 60)
        grade = 'C';
    else
        grade = 'F';
    printf("%c %s\\n", grade, mark >= 60 ? "pass" : "fail");

    switch (grade) {
    case 'A':
    case 'B':
        printf("Great\\n");
        break;
    default:
        printf("Keep going\\n");
    }
    return 0;
}
`,
        stdin: '84\n',
      },
    },
  },
  {
    id: 'loops',
    title: 'Loops',
    python: {
      intro: 'for walks over a sequence; while repeats while a condition holds.',
      notes: [
        'range(5) is 0..4; range(2, 10, 3) is 2, 5, 8.',
        'enumerate gives index and value; zip walks two lists together.',
        'break leaves the loop, continue skips to the next round.',
      ],
      example: {
        code: `for i in range(1, 4):
    print("round", i)

for index, fruit in enumerate(["apple", "kiwi"]):
    print(index, fruit)

n = 10
while n > 0:
    n -= 3
    if n == 4:
        continue
    print("n =", n)
`,
      },
    },
    c: {
      intro: 'for, while and do-while.',
      notes: [
        'for (init; condition; step) is the usual counting loop.',
        'do { } while (cond); always runs at least once.',
        'break and continue work as in Python.',
      ],
      example: {
        code: `#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 3; i++)
        printf("round %d\\n", i);

    int n = 10;
    while (n > 0) {
        n -= 3;
        if (n == 4)
            continue;
        printf("n = %d\\n", n);
    }

    int k = 100;
    do {
        printf("do-while runs once even though k = %d\\n", k);
    } while (k < 10);
    return 0;
}
`,
      },
    },
  },
  {
    id: 'functions',
    title: 'Functions',
    python: {
      intro: 'def defines a function; return sends a value back.',
      notes: [
        'Parameters can have default values: def f(x, times=2).',
        'A function can return several values as a tuple.',
        'Variables assigned inside a function are local to it.',
      ],
      example: {
        code: `def area(width, height=1):
    return width * height

def min_max(numbers):
    return min(numbers), max(numbers)

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(area(3, 4), area(5))
low, high = min_max([4, 9, 1])
print(low, high, factorial(5))
`,
      },
    },
    c: {
      intro: 'A function has a return type, a name and typed parameters.',
      notes: [
        'Declare (or define) a function before calling it.',
        'Arguments are copied (pass by value): to change a caller variable, pass its address.',
        'void means "returns nothing" or "takes no parameters".',
      ],
      example: {
        code: `#include <stdio.h>

int area(int width, int height);   /* prototype: defined below */

int factorial(int n) {
    if (n <= 1)
        return 1;
    return n * factorial(n - 1);
}

void greet(void) {
    printf("Hello from greet\\n");
}

int main(void) {
    greet();
    printf("%d %d\\n", area(3, 4), factorial(5));
    return 0;
}

int area(int width, int height) {
    return width * height;
}
`,
      },
    },
  },
  {
    id: 'arrays',
    title: 'Lists and arrays',
    python: {
      intro: 'Lists grow and shrink, and can hold any values.',
      notes: [
        'Indexing starts at 0; a[-1] is the last element.',
        'Slicing: a[1:3] is items 1 and 2; a[::-1] reverses.',
        'append, insert, pop, remove, sort, len, in.',
        'List comprehension: [x * x for x in a if x > 0].',
      ],
      example: {
        code: `marks = [70, 85, 92]
marks.append(60)
marks.insert(0, 99)
print(marks, len(marks), marks[0], marks[-1])
print(marks[1:3], marks[::-1])
marks.sort()
print(marks, 85 in marks)
squares = [m // 10 for m in marks if m >= 70]
print(squares)

grid = [[0] * 3 for _ in range(2)]
grid[1][2] = 5
print(grid)
`,
      },
    },
    c: {
      intro: 'An array has a fixed size and one element type.',
      notes: [
        'int a[5]; indexes 0 to 4. C never checks bounds: a[5] is a bug, not an error.',
        'The size must be known; pass it to functions separately.',
        'int m[2][3] is a 2D array (2 rows, 3 columns).',
        'An array passed to a function becomes a pointer to its first element.',
      ],
      example: {
        code: `#include <stdio.h>

double average(const int a[], int n) {
    int sum = 0;
    for (int i = 0; i < n; i++)
        sum += a[i];
    return (double)sum / n;
}

int main(void) {
    int marks[4] = {70, 85, 92, 60};
    int n = sizeof marks / sizeof marks[0];
    printf("%d elements, average %.2f\\n", n, average(marks, n));

    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    for (int r = 0; r < 2; r++) {
        for (int c = 0; c < 3; c++)
            printf("%d ", grid[r][c]);
        printf("\\n");
    }
    return 0;
}
`,
      },
    },
  },
  {
    id: 'strings',
    title: 'Strings',
    python: {
      intro: 'str is an immutable sequence of characters with many methods.',
      notes: [
        'Single or double quotes; """triple quotes""" span lines.',
        'Methods: upper, lower, strip, split, join, replace, find, startswith.',
        'Strings cannot be changed in place: methods return a new string.',
      ],
      example: {
        code: `s = "  Hello, World  "
t = s.strip()
print(t.upper(), t.lower(), len(t))
print(t.split(", "), "-".join(["a", "b", "c"]))
print(t.replace("World", "LIU"), t.find("World"), t[0], t[-1])
for ch in "abc":
    print(ch, ord(ch))
`,
      },
    },
    c: {
      intro: "A string is a char array ending with the null character '\\0'.",
      notes: [
        '#include <string.h> for strlen, strcpy, strcat, strcmp.',
        "char s[10] holds at most 9 characters plus the '\\0'.",
        'Compare strings with strcmp(a, b) == 0, never with ==.',
        "A char is a small number: 'A' is 65.",
      ],
      example: {
        code: `#include <stdio.h>
#include <string.h>

int main(void) {
    char first[20] = "Hello";
    char second[] = "World";

    strcat(first, ", ");
    strcat(first, second);
    printf("%s (length %zu)\\n", first, strlen(first));

    printf("same? %d\\n", strcmp(second, "World") == 0);
    for (int i = 0; second[i] != '\\0'; i++)
        printf("%c=%d ", second[i], second[i]);
    printf("\\n");
    return 0;
}
`,
      },
    },
  },
  {
    id: 'collections',
    title: 'Dictionaries / pointers',
    python: {
      intro: 'A dict maps keys to values; sets hold unique items; tuples are fixed lists.',
      notes: [
        'd[key] reads (KeyError if missing); d.get(key, default) does not fail.',
        'for key, value in d.items() walks the pairs.',
        'Sets: {1, 2, 3}, with union |, intersection &, difference -.',
      ],
      example: {
        code: `ages = {"Lea": 20, "Ali": 22}
ages["Yara"] = 19
print(ages["Lea"], ages.get("Omar", "unknown"))
for name, age in sorted(ages.items()):
    print(name, age)

evens = {0, 2, 4, 6}
small = {0, 1, 2, 3}
print(evens & small, evens | small, evens - small)

point = (3, 4)
x, y = point
print(x, y)
`,
      },
    },
    c: {
      intro: 'A pointer holds the address of another variable.',
      notes: [
        '&x is the address of x; *p is the value p points to.',
        "Pass a pointer to let a function change the caller's variable.",
        'p + 1 moves to the next element of an array; a[i] is *(a + i).',
        'NULL means "points nowhere": check before using *p.',
      ],
      example: {
        code: `#include <stdio.h>

void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

int main(void) {
    int x = 1, y = 2;
    int *p = &x;
    *p = 10;               /* changes x through p */
    swap(&x, &y);
    printf("x=%d y=%d\\n", x, y);

    int a[3] = {5, 6, 7};
    int *q = a;            /* same as &a[0] */
    printf("%d %d %d\\n", *q, *(q + 1), q[2]);
    return 0;
}
`,
      },
    },
  },
  {
    id: 'records',
    title: 'Classes / structs',
    python: {
      intro: 'A class bundles data (attributes) and behaviour (methods).',
      notes: [
        '__init__ runs when an object is created; self is the object.',
        '__str__ decides what print() shows.',
        'Methods are called with a dot: s.average().',
      ],
      example: {
        code: `class Student:
    def __init__(self, name, marks):
        self.name = name
        self.marks = marks

    def average(self):
        return sum(self.marks) / len(self.marks)

    def __str__(self):
        return f"{self.name} ({self.average():.1f})"

s = Student("Lea", [80, 90, 85])
print(s)
s.marks.append(100)
print(s.average())
`,
      },
    },
    c: {
      intro: 'A struct groups related variables of different types.',
      notes: [
        'Access fields with a dot: s.name. Through a pointer: p->name.',
        'typedef struct { ... } Student; lets you write Student instead of struct ...',
        'Structs are copied when assigned or passed by value.',
      ],
      example: {
        code: `#include <stdio.h>

typedef struct {
    char name[20];
    int marks[3];
} Student;

double average(const Student *s) {
    return (s->marks[0] + s->marks[1] + s->marks[2]) / 3.0;
}

int main(void) {
    Student s = {"Lea", {80, 90, 85}};
    printf("%s: %.1f\\n", s.name, average(&s));

    Student copy = s;      /* a full copy */
    copy.marks[0] = 0;
    printf("original %d, copy %d\\n", s.marks[0], copy.marks[0]);
    return 0;
}
`,
      },
    },
  },
  {
    id: 'memory',
    title: 'Errors / dynamic memory',
    python: {
      intro: 'Errors raise exceptions, which you can catch with try / except.',
      notes: [
        'Common ones: ValueError, IndexError, KeyError, ZeroDivisionError, TypeError.',
        'raise ValueError("message") signals your own error.',
        'finally runs whether or not an error happened.',
      ],
      example: {
        code: `def safe_divide(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        print("cannot divide by zero")
        return None
    finally:
        print("done dividing")

print(safe_divide(10, 4))
print(safe_divide(1, 0))

try:
    n = int("abc")
except ValueError as e:
    print("bad number:", e)
`,
      },
    },
    c: {
      intro: 'malloc reserves memory on the heap at run time; free gives it back.',
      notes: [
        '#include <stdlib.h>. malloc(n * sizeof(int)) returns a pointer or NULL.',
        'Every malloc needs exactly one free when you are done.',
        'Using memory after free, or freeing twice, is undefined behaviour.',
        'realloc grows or shrinks a block.',
      ],
      example: {
        code: `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n;
    scanf("%d", &n);
    int *a = malloc(n * sizeof *a);
    if (a == NULL) {
        printf("out of memory\\n");
        return 1;
    }
    for (int i = 0; i < n; i++)
        a[i] = i * i;

    a = realloc(a, (n + 1) * sizeof *a);
    a[n] = -1;
    for (int i = 0; i <= n; i++)
        printf("%d ", a[i]);
    printf("\\n");
    free(a);
    return 0;
}
`,
        stdin: '5\n',
      },
    },
  },
];

export const LANGUAGE_NAMES: Record<Language, string> = { python: 'Python', c: 'C' };
