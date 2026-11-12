/** Sample databases. Each one is plain SQL, so students can read exactly what was created. */
export interface Dataset {
  id: string;
  title: string;
  description: string;
  sql: string;
}

const university = `
CREATE TABLE departments (
  dept_id   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  building  TEXT,
  budget    INTEGER
);

CREATE TABLE instructors (
  instructor_id INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  dept_id       INTEGER REFERENCES departments(dept_id),
  salary        INTEGER,
  hire_year     INTEGER
);

CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  major_dept INTEGER REFERENCES departments(dept_id),
  year       INTEGER CHECK (year BETWEEN 1 AND 4),
  gpa        REAL
);

CREATE TABLE courses (
  course_id TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  dept_id   INTEGER REFERENCES departments(dept_id),
  credits   INTEGER
);

CREATE TABLE prerequisites (
  course_id TEXT REFERENCES courses(course_id),
  prereq_id TEXT REFERENCES courses(course_id),
  PRIMARY KEY (course_id, prereq_id)
);

CREATE TABLE sections (
  section_id    INTEGER PRIMARY KEY,
  course_id     TEXT REFERENCES courses(course_id),
  instructor_id INTEGER REFERENCES instructors(instructor_id),
  semester      TEXT,
  year          INTEGER,
  room          TEXT
);

CREATE TABLE enrollments (
  student_id INTEGER REFERENCES students(student_id),
  section_id INTEGER REFERENCES sections(section_id),
  grade      TEXT,
  PRIMARY KEY (student_id, section_id)
);

INSERT INTO departments VALUES
  (1, 'Computer Science', 'Engineering A', 950000),
  (2, 'Mathematics', 'Science B', 620000),
  (3, 'Electrical Engineering', 'Engineering B', 870000),
  (4, 'Business', 'Main', 540000),
  (5, 'Physics', 'Science A', 480000);

INSERT INTO instructors VALUES
  (101, 'Rana Haddad', 1, 92000, 2012),
  (102, 'Karim Saleh', 1, 81000, 2017),
  (103, 'Maya Khoury', 1, 76000, 2020),
  (104, 'Omar Nassar', 2, 70000, 2010),
  (105, 'Lina Farah', 2, 68000, 2019),
  (106, 'Ziad Mansour', 3, 88000, 2014),
  (107, 'Nour Aoun', 4, 65000, 2021),
  (108, 'Hadi Jaber', 5, 72000, 2016),
  (109, 'Sara Itani', NULL, 60000, 2023);

INSERT INTO students VALUES
  (1, 'Ali Hamdan', 1, 3, 3.45),
  (2, 'Yara Daher', 1, 2, 3.80),
  (3, 'Jad Khalil', 1, 4, 2.95),
  (4, 'Rami Sleiman', 2, 1, 3.10),
  (5, 'Lea Moussa', 1, 1, 3.65),
  (6, 'Hassan Ali', 3, 2, 2.70),
  (7, 'Mira Abboud', 4, 3, 3.25),
  (8, 'Karim Fakih', 1, 2, 2.40),
  (9, 'Tala Rizk', 2, 4, 3.90),
  (10, 'Fadi Chamoun', 3, 3, 3.05),
  (11, 'Dana Kassem', 1, 3, 3.55),
  (12, 'Samir Hijazi', 5, 2, 2.85),
  (13, 'Rita Nader', 4, 1, 3.15),
  (14, 'Bilal Srour', 1, 4, 3.00),
  (15, 'Nadine Issa', NULL, 1, NULL);

INSERT INTO courses VALUES
  ('CSCI250', 'Introduction to Programming', 1, 3),
  ('CSCI300', 'Data Structures', 1, 3),
  ('CSCI350', 'Algorithms', 1, 3),
  ('CSCI390', 'Database Systems', 1, 3),
  ('CSCI430', 'Operating Systems', 1, 3),
  ('MATH210', 'Discrete Mathematics', 2, 3),
  ('MATH220', 'Linear Algebra', 2, 3),
  ('ELEC300', 'Digital Logic', 3, 4),
  ('BUSN200', 'Principles of Management', 4, 3),
  ('PHYS210', 'Physics I', 5, 4);

INSERT INTO prerequisites VALUES
  ('CSCI300', 'CSCI250'),
  ('CSCI350', 'CSCI300'),
  ('CSCI350', 'MATH210'),
  ('CSCI390', 'CSCI300'),
  ('CSCI430', 'CSCI300'),
  ('ELEC300', 'PHYS210');

INSERT INTO sections VALUES
  (1, 'CSCI250', 102, 'Fall', 2025, 'A101'),
  (2, 'CSCI250', 103, 'Spring', 2026, 'A101'),
  (3, 'CSCI300', 101, 'Fall', 2025, 'A204'),
  (4, 'CSCI350', 101, 'Spring', 2026, 'A204'),
  (5, 'CSCI390', 103, 'Spring', 2026, 'A110'),
  (6, 'CSCI430', 102, 'Spring', 2026, 'Lab 3'),
  (7, 'MATH210', 104, 'Fall', 2025, 'B12'),
  (8, 'MATH220', 105, 'Spring', 2026, 'B12'),
  (9, 'ELEC300', 106, 'Fall', 2025, 'E05'),
  (10, 'BUSN200', 107, 'Spring', 2026, 'M2'),
  (11, 'PHYS210', 108, 'Fall', 2025, 'S1');

INSERT INTO enrollments VALUES
  (1, 3, 'A'), (1, 6, 'B+'), (1, 7, 'B'),
  (2, 1, 'A'), (2, 3, 'A-'), (2, 5, 'A'),
  (3, 4, 'C+'), (3, 6, 'B'), (3, 5, 'B-'),
  (4, 7, 'B'), (4, 8, 'A-'),
  (5, 1, 'A-'), (5, 7, 'A'),
  (6, 9, 'C'), (6, 11, 'B-'),
  (7, 10, 'B+'), (7, 2, 'B'),
  (8, 1, 'C'), (8, 3, 'D'), (8, 7, 'C+'),
  (9, 8, 'A'), (9, 7, 'A'), (9, 4, 'A-'),
  (10, 9, 'B'), (10, 11, 'B+'),
  (11, 3, 'B+'), (11, 4, 'B'), (11, 6, 'A-'),
  (12, 11, 'C+'), (12, 8, 'B-'),
  (13, 10, 'A'),
  (14, 4, 'B-'), (14, 5, 'C'), (14, 6, NULL);
`;

const company = `
CREATE TABLE departments (
  dept_id  INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  location TEXT
);

CREATE TABLE employees (
  emp_id     INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name  TEXT NOT NULL,
  dept_id    INTEGER REFERENCES departments(dept_id),
  manager_id INTEGER REFERENCES employees(emp_id),
  job_title  TEXT,
  salary     INTEGER,
  hire_date  TEXT
);

CREATE TABLE projects (
  project_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  dept_id    INTEGER REFERENCES departments(dept_id),
  budget     INTEGER
);

CREATE TABLE works_on (
  emp_id     INTEGER REFERENCES employees(emp_id),
  project_id INTEGER REFERENCES projects(project_id),
  hours      INTEGER,
  PRIMARY KEY (emp_id, project_id)
);

INSERT INTO departments VALUES
  (10, 'Engineering', 'Beirut'),
  (20, 'Sales', 'Tripoli'),
  (30, 'Finance', 'Beirut'),
  (40, 'Support', 'Saida'),
  (50, 'Research', NULL);

INSERT INTO employees VALUES
  (1, 'Nadia', 'Karam', 10, NULL, 'CTO', 150000, '2015-03-01'),
  (2, 'Elie', 'Sfeir', 10, 1, 'Engineering Manager', 110000, '2016-07-15'),
  (3, 'Rawan', 'Hajj', 10, 2, 'Software Engineer', 85000, '2019-01-10'),
  (4, 'Tarek', 'Zein', 10, 2, 'Software Engineer', 82000, '2020-09-01'),
  (5, 'Joelle', 'Azar', 10, 2, 'Junior Engineer', 60000, '2023-02-20'),
  (6, 'Marwan', 'Toufic', 20, 1, 'Sales Director', 105000, '2014-11-05'),
  (7, 'Celine', 'Ghanem', 20, 6, 'Account Executive', 64000, '2021-04-12'),
  (8, 'Walid', 'Bitar', 20, 6, 'Account Executive', 61000, '2022-06-30'),
  (9, 'Hala', 'Matar', 30, 1, 'Finance Manager', 98000, '2017-08-08'),
  (10, 'Georges', 'Najjar', 30, 9, 'Accountant', 58000, '2020-01-15'),
  (11, 'Rima', 'Saad', 40, 1, 'Support Lead', 70000, '2018-05-21'),
  (12, 'Fouad', 'Hobeika', 40, 11, 'Support Agent', 45000, '2022-10-03'),
  (13, 'Lara', 'Chidiac', 40, 11, 'Support Agent', 47000, '2021-12-01'),
  (14, 'Imad', 'Rahal', NULL, 1, 'Consultant', 90000, '2024-03-18');

INSERT INTO projects VALUES
  (100, 'Mobile App', 10, 250000),
  (101, 'Billing Revamp', 30, 120000),
  (102, 'CRM Rollout', 20, 90000),
  (103, 'Help Center', 40, 40000),
  (104, 'AI Assistant', 10, 300000),
  (105, 'Market Study', NULL, 30000);

INSERT INTO works_on VALUES
  (2, 100, 10), (3, 100, 30), (4, 100, 25), (5, 100, 40),
  (3, 104, 10), (4, 104, 15), (1, 104, 5),
  (9, 101, 20), (10, 101, 35), (3, 101, 5),
  (6, 102, 10), (7, 102, 30), (8, 102, 30),
  (11, 103, 15), (12, 103, 25);
`;

const shop = `
CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  joined      TEXT
);

CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT,
  price      REAL,
  stock      INTEGER
);

CREATE TABLE orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(customer_id),
  order_date  TEXT,
  status      TEXT CHECK (status IN ('pending', 'shipped', 'delivered', 'cancelled'))
);

CREATE TABLE order_items (
  order_id   INTEGER REFERENCES orders(order_id),
  product_id INTEGER REFERENCES products(product_id),
  quantity   INTEGER,
  unit_price REAL,
  PRIMARY KEY (order_id, product_id)
);

INSERT INTO customers VALUES
  (1, 'Ahmad Younes', 'Beirut', '2024-01-12'),
  (2, 'Christelle Abi Nader', 'Jounieh', '2024-02-03'),
  (3, 'Mohammad Kanaan', 'Tripoli', '2024-03-19'),
  (4, 'Sara Haidar', 'Beirut', '2024-05-07'),
  (5, 'Peter Daou', 'Zahle', '2024-06-25'),
  (6, 'Zeina Hamzeh', 'Saida', '2025-01-02');

INSERT INTO products VALUES
  (1, 'Laptop', 'Electronics', 899.00, 12),
  (2, 'Wireless Mouse', 'Electronics', 19.50, 150),
  (3, 'USB-C Hub', 'Electronics', 35.00, 80),
  (4, 'Notebook (A4)', 'Stationery', 3.25, 500),
  (5, 'Gel Pens (10)', 'Stationery', 6.75, 300),
  (6, 'Backpack', 'Accessories', 42.00, 40),
  (7, 'Desk Lamp', 'Home', 27.90, 0),
  (8, 'Monitor 24"', 'Electronics', 179.00, 25);

INSERT INTO orders VALUES
  (1000, 1, '2025-09-01', 'delivered'),
  (1001, 2, '2025-09-03', 'delivered'),
  (1002, 1, '2025-09-10', 'shipped'),
  (1003, 3, '2025-09-11', 'cancelled'),
  (1004, 4, '2025-09-15', 'delivered'),
  (1005, 2, '2025-10-01', 'pending'),
  (1006, 5, '2025-10-02', 'shipped'),
  (1007, 4, '2025-10-05', 'pending');

INSERT INTO order_items VALUES
  (1000, 1, 1, 899.00), (1000, 2, 1, 19.50),
  (1001, 4, 10, 3.25), (1001, 5, 2, 6.75),
  (1002, 8, 2, 175.00), (1002, 3, 1, 35.00),
  (1003, 6, 1, 42.00),
  (1004, 2, 3, 19.50), (1004, 4, 5, 3.25), (1004, 6, 1, 40.00),
  (1005, 1, 1, 869.00),
  (1006, 5, 4, 6.75), (1006, 7, 1, 27.90),
  (1007, 3, 2, 35.00), (1007, 8, 1, 179.00);
`;

export const DATASETS: readonly Dataset[] = [
  {
    id: 'university',
    title: 'University',
    description:
      'Departments, instructors, students, courses, prerequisites, sections and enrollments.',
    sql: university.trim(),
  },
  {
    id: 'company',
    title: 'Company',
    description: 'Employees with managers (a self join), departments, projects and hours worked.',
    sql: company.trim(),
  },
  {
    id: 'shop',
    title: 'Online shop',
    description: 'Customers, products, orders and order items, for joins and aggregates.',
    sql: shop.trim(),
  },
  {
    id: 'empty',
    title: 'Empty database',
    description: 'Nothing created yet: practise CREATE TABLE, INSERT and constraints.',
    sql: '',
  },
];

export function datasetById(id: string): Dataset {
  return DATASETS.find((d) => d.id === id) ?? (DATASETS[0] as Dataset);
}
