# Запуск, развёртывание и обновление

## 1. Требования

- **Node.js 22.18 или новее** (рекомендуется 24 LTS). Сервер написан на TypeScript и запускается Node.js напрямую, без сборки.
- 1 ГБ ОЗУ, 2 ГБ диска (база текущих данных — около 10 МБ).
- ОС: Linux (Ubuntu 22.04/24.04) или Windows Server / Windows 10–11.
- Для доступа из сети — доменное имя и HTTPS-сертификат (Let's Encrypt или сертификат организации).

Отдельный сервер СУБД не нужен: база — файл SQLite в каталоге `data/`.

## 2. Локальный запуск (проверка на одном компьютере)

```bash
cd zhkh-portal
npm run setup                 # установка зависимостей сервера и интерфейса
npm run build                 # сборка интерфейса в client/dist
npm run create-admin -- --login admin --name "Фамилия И.О."   # пароль запросит консоль
npm run import-initial -- "../МЖД 1240 2025 жыл0313115516 (2).xlsx" "../Список энергообъектов за 2026  ЖКХ (2).xlsx" "../Таблица КСК 2020-2024 г!!!!!.xlsx"
npm start                     # http://127.0.0.1:3000
```

Повторный запуск `import-initial` с теми же файлами безопасен: дубликаты не создаются (записи будут «без изменений»).

Режим разработки: `npm run dev:server` (порт 3000) и `npm run dev:client` (порт 5173 с проксированием /api).

Проверки: `npm test` (14 автотестов: импорт реальных файлов, права, вход, CSRF, повторный импорт и откат, экспорт, резервные копии, публичный режим), `npm run typecheck`.

## 3. Размещение на сервере Linux (Ubuntu)

### 3.1. Установка

```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/zhkh zhkh
sudo -u zhkh git clone <репозиторий> /opt/zhkh/app    # или скопируйте папку zhkh-portal
cd /opt/zhkh/app
sudo -u zhkh npm run setup && sudo -u zhkh npm run build
sudo -u zhkh cp .env.example .env    # затем отредактируйте .env:
#   HOST=127.0.0.1  PORT=3000  NODE_ENV=production  COOKIE_SECURE=true  TRUST_PROXY=true
sudo chmod 600 .env
sudo -u zhkh npm run create-admin -- --login admin --name "Фамилия И.О."
```

### 3.2. Служба systemd — `/etc/systemd/system/zhkh.service`

```ini
[Unit]
Description=ЦИС ЖКХ г. Атырау
After=network.target

[Service]
User=zhkh
WorkingDirectory=/opt/zhkh/app/server
ExecStart=/usr/bin/node src/index.ts
Restart=always
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/opt/zhkh/app/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now zhkh
sudo journalctl -u zhkh -f      # журнал сервера
```

### 3.3. nginx и HTTPS — `/etc/nginx/sites-available/zhkh`

```nginx
server {
    listen 80;
    server_name zhkh.example.kz;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name zhkh.example.kz;
    ssl_certificate     /etc/letsencrypt/live/zhkh.example.kz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zhkh.example.kz/privkey.pem;
    client_max_body_size 30m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/zhkh /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d zhkh.example.kz
sudo nginx -t && sudo systemctl reload nginx
```

Политика доступа: по умолчанию сайт закрыт (только вход по логину). Если портал должен быть доступен только из сети учреждения или через VPN, ограничьте доступ в nginx (`allow 10.0.0.0/8; deny all;`) или межсетевым экраном.

## 4. Windows Server

1. Установите Node.js 24 LTS (msi с nodejs.org).
2. Скопируйте папку `zhkh-portal` в `C:\zhkh`, выполните в PowerShell: `npm run setup; npm run build; npm run create-admin -- --login admin --name "Фамилия И.О."`.
3. Настройте `.env` (как в п. 3.1).
4. Запуск как службы — через NSSM (`nssm install ZHKH "C:\Program Files\nodejs\node.exe" "src\index.ts"`, рабочая папка `C:\zhkh\server`) или Планировщик заданий «при запуске системы».
5. HTTPS — через IIS (ARR + URL Rewrite, обратный прокси на `http://127.0.0.1:3000`) или nginx для Windows.

> Не размещайте папку `data/` в OneDrive/Dropbox на рабочем сервере: синхронизация может повредить открытую базу. Для локальной проверки это допустимо.

## 5. Создание первого администратора и пользователей

- `npm run create-admin -- --login admin --name "Фамилия И.О."` — создаёт администратора или сбрасывает его пароль (если логин уже есть). Пароль — не менее 10 символов, буквы и цифры.
- Остальных сотрудников создаёт администратор в разделе «Администрирование → Пользователи». Новый пользователь получает временный пароль и обязан сменить его при первом входе.
- Роли: «Администратор», «Редактор», «Пользователь»; дополнительные роли (например, «Только электрохозяйство») создаются в «Роли и права».

## 6. Обновление системы

```bash
sudo -u zhkh npm run backup          # копия базы перед обновлением
cd /opt/zhkh/app && sudo -u zhkh git pull   # или замените файлы, НЕ трогая data/ и .env
sudo -u zhkh npm run setup && sudo -u zhkh npm run build
sudo systemctl restart zhkh
```

Изменения структуры базы применяются автоматически при запуске (миграции в `server/src/db/schema.ts`, номер версии — `PRAGMA user_version`).

## 7. Обновление данных из новых версий Excel

«Администрирование → Импорт Excel»: загрузка файла → выбор листа → (для нестандартных таблиц — сопоставление столбцов) → отчёт: новые, изменённые (с перечнем полей «было → стало»), без изменений, не прошедшие проверку, отсутствующие в файле, возможные дубликаты → снятие/установка отметок → «Применить». Перед применением создаётся резервная копия; импорт можно откатить в «Истории импорта».

## 8. Какие сведения передаются внешним сервисам

- **Ни данные объектов, ни учётные данные не передаются никаким внешним сервисам.**
- Исключение — страница «Карта объектов», если у объектов внесены координаты: браузер пользователя загружает фоновые тайлы карты с `tile.openstreetmap.org` (передаются IP-адрес пользователя и запрашиваемый участок карты). Пока координат нет, карта не загружается. Для интенсивного использования OSM рекомендуется собственный сервер тайлов или коммерческий сервис (условия: https://operations.osmfoundation.org/policies/tiles/).
