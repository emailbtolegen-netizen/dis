import type { Request } from 'express';
import { run } from '../db/db.ts';

/** Журнал важных действий пользователей (вход, импорт, экспорт, изменения прав, резервные копии…). */
export function audit(req: Request | null, action: string, entity?: string | null, entityId?: string | number | null, details?: unknown): void {
  const user = req?.user;
  run(
    'INSERT INTO audit_log(user_id, user_login, action, entity, entity_id, details, ip) VALUES(?,?,?,?,?,?,?)',
    user?.id ?? null, user?.login ?? null, action, entity ?? null, entityId == null ? null : String(entityId),
    details == null ? null : JSON.stringify(details), req?.ip ?? null,
  );
}

export const AUDIT_ACTIONS: Record<string, string> = {
  'auth.login': 'Вход в систему',
  'auth.login_failed': 'Неудачная попытка входа',
  'auth.logout': 'Выход',
  'auth.password_changed': 'Смена пароля',
  'user.create': 'Создание пользователя',
  'user.update': 'Изменение пользователя',
  'user.password_reset': 'Сброс пароля пользователя',
  'role.create': 'Создание роли',
  'role.update': 'Изменение роли',
  'role.delete': 'Удаление роли',
  'object.create': 'Создание объекта',
  'object.update': 'Изменение объекта',
  'object.delete': 'Удаление объекта',
  'object.restore': 'Восстановление объекта',
  'link.create': 'Создание связи',
  'link.review': 'Проверка связи',
  'link.delete': 'Удаление связи',
  'attachment.upload': 'Загрузка файла',
  'attachment.delete': 'Удаление файла',
  'import.upload': 'Загрузка файла для импорта',
  'import.preview': 'Предпросмотр импорта',
  'import.apply': 'Применение импорта',
  'import.rollback': 'Откат импорта',
  'import.discard': 'Отмена импорта',
  'export.objects': 'Экспорт объектов в Excel',
  'export.quality': 'Экспорт отчёта качества',
  'export.audit': 'Экспорт журнала',
  'backup.create': 'Создание резервной копии',
  'backup.restore': 'Восстановление из резервной копии',
  'backup.download': 'Скачивание резервной копии',
  'category.create': 'Создание категории',
  'category.update': 'Изменение категории',
  'settings.update': 'Изменение настроек',
};
