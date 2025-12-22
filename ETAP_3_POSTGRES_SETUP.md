# Этап 3: Настройка Fly.io Managed Postgres - ЗАВЕРШЕН

## ✅ Статус: Настройка завершена успешно

**Дата выполнения:** 2025-12-14

---

## Выполненные задачи

### 1. Создание Managed Postgres кластера ✅

**Команда:**
```bash
flyctl mpg create --name abc-metrics-db --region iad --plan development --volume-size 10
```

**Результат:**
- ✅ Кластер создан успешно
- **ID кластера:** `q49ypo4w4mpr17ln`
- **Имя:** `abc-metrics-db`
- **Регион:** `iad` (Washington, D.C.)
- **План:** `basic` (Shared x 2 CPU, 1 GB RAM)
- **Диск:** 10 GB
- **Стоимость:** $38/месяц

**Connection string:**
```
postgresql://fly-user:C9rN1sqxoaoPDoBgWlSGY5yx@pgbouncer.q49ypo4w4mpr17ln.flympg.net/fly-db
```

### 2. Присоединение базы данных к приложению ✅

**Команды:**
```bash
# Удаление старого DATABASE_URL (если был)
flyctl secrets unset DATABASE_URL -a abc-metrics

# Присоединение нового кластера
flyctl mpg attach q49ypo4w4mpr17ln --app abc-metrics
```

**Результат:**
- ✅ База данных успешно присоединена к приложению `abc-metrics`
- ✅ Переменная окружения `DATABASE_URL` установлена автоматически
- ✅ Приложение перезапущено с новой конфигурацией

### 3. Проверка конфигурации ✅

**Проверка переменных окружения:**
```bash
flyctl secrets list -a abc-metrics | grep DATABASE_URL
```

**Результат:**
- ✅ `DATABASE_URL` установлен и скрыт в secrets

---

## Конфигурация базы данных

### Параметры кластера

- **Тип:** Fly.io Managed Postgres (MPG)
- **Версия PostgreSQL:** 16 (по умолчанию)
- **Регион:** `iad` (Washington, D.C., USA)
- **План:** Basic
  - CPU: Shared x 2
  - Memory: 1 GB
  - Disk: 10 GB
- **PostGIS:** Отключен
- **PgBouncer:** Включен (для connection pooling)

### Подключение

**Внутреннее подключение (рекомендуется):**
- Используется `pgbouncer` для connection pooling
- Подключение через внутреннюю сеть Fly.io
- SSL автоматически обрабатывается

**Connection string формат:**
```
postgresql://fly-user:PASSWORD@pgbouncer.CLUSTER_ID.flympg.net/fly-db
```

---

## Следующие шаги

### 1. Проверка работы приложения

```bash
# Проверить статус
flyctl status -a abc-metrics

# Проверить логи
flyctl logs -a abc-metrics

# Проверить подключение к БД в логах
flyctl logs -a abc-metrics | grep -i "database\|postgres\|connected"
```

### 2. Запуск миграций

Миграции запускаются автоматически при старте приложения. Для ручного запуска:

```bash
flyctl ssh console -a abc-metrics
cd /app
npm run migrate
```

### 3. Проверка таблиц

После миграций можно проверить созданные таблицы:

```bash
flyctl mpg connect --cluster q49ypo4w4mpr17ln
```

В psql:
```sql
\dt  -- список таблиц
SELECT COUNT(*) FROM jobs;  -- проверка данных
```

---

## Управление базой данных

### Полезные команды

**Просмотр статуса кластера:**
```bash
flyctl mpg status q49ypo4w4mpr17ln
```

**Подключение к базе:**
```bash
flyctl mpg connect --cluster q49ypo4w4mpr17ln
```

**Список всех кластеров:**
```bash
flyctl mpg list
```

**Просмотр информации о кластере:**
```bash
flyctl mpg show q49ypo4w4mpr17ln
```

**Создание резервной копии:**
```bash
flyctl mpg backup create --cluster q49ypo4w4mpr17ln
```

**Список резервных копий:**
```bash
flyctl mpg backup list --cluster q49ypo4w4mpr17ln
```

---

## Мониторинг

### Дашборд Fly.io

Кластер доступен в веб-интерфейсе:
```
https://fly.io/dashboard/assistance-team/managed_postgres/q49ypo4w4mpr17ln
```

### Метрики

- CPU usage
- Memory usage
- Disk usage
- Connection count
- Query performance

---

## Безопасность

### SSL/TLS

- ✅ Подключения через PgBouncer используют SSL
- ✅ Внутренние подключения в сети Fly.io безопасны
- ✅ Внешние подключения требуют SSL

### Аутентификация

- ✅ Используется парольная аутентификация
- ✅ Пароль хранится в secrets Fly.io
- ✅ Доступ только через `DATABASE_URL` в secrets

### Резервное копирование

- ✅ Fly.io автоматически создает резервные копии
- ✅ Можно создавать ручные резервные копии
- ✅ Восстановление через `flyctl mpg backup restore`

---

## Важные замечания

1. **Connection Pooling:** Используется PgBouncer для эффективного управления соединениями
2. **Внутренняя сеть:** Подключение через внутреннюю сеть Fly.io (flycast/internal)
3. **Автоматические обновления:** Fly.io управляет обновлениями PostgreSQL
4. **Масштабирование:** Можно увеличить план при необходимости
5. **Резервные копии:** Рекомендуется настроить автоматические резервные копии

---

## Результат

✅ **Этап 3 завершен успешно**

- Managed Postgres кластер создан
- База данных присоединена к приложению
- `DATABASE_URL` настроен автоматически
- Приложение готово к использованию базы данных

---

**Подготовил:** AI Assistant  
**Дата:** 2025-12-14  
**Версия:** 1.0



