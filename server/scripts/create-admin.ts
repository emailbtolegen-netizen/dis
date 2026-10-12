/**
 * Создание (или сброс пароля) администратора.
 *   npm run create-admin -- --login admin --name "Иванов И.И."
 * Пароль запрашивается в консоли или берётся из переменной окружения ADMIN_PASSWORD.
 */
import readline from 'node:readline';
import { hashPassword, passwordProblem } from '../src/auth/auth.ts';
import { bootstrap } from '../src/bootstrap.ts';
import { get, run } from '../src/db/db.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => { out.output.write(muted ? '' : s); };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

bootstrap();
const login = arg('login') ?? 'admin';
const name = arg('name') ?? 'Администратор системы';
let password = process.env.ADMIN_PASSWORD ?? '';
if (!password) {
  password = await askHidden(`Пароль для «${login}» (не менее 10 символов, буквы и цифры): `);
  const again = await askHidden('Повторите пароль: ');
  if (again !== password) {
    console.error('Пароли не совпадают');
    process.exit(1);
  }
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const role = get(`SELECT id FROM roles WHERE code = 'admin'`)!;
const existing = get('SELECT id FROM users WHERE login = ?', login);
if (existing) {
  run('UPDATE users SET password_hash = ?, role_id = ?, is_active = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?', hashPassword(password), role.id, existing.id);
  console.log(`Пароль администратора «${login}» обновлён.`);
} else {
  run('INSERT INTO users(login, full_name, password_hash, role_id, must_change_password) VALUES(?,?,?,?,0)', login, name, hashPassword(password), role.id);
  console.log(`Администратор «${login}» создан.`);
}
run(`INSERT INTO audit_log(action, entity, entity_id, details) VALUES('user.create', 'user', ?, '{"via":"create-admin script"}')`, login);
