#!/bin/bash

# Скрипт для установки модуля метрик в rely-lead-processor
# Использование: ./install-metrics-module.sh /path/to/rely-lead-processor

set -e

if [ -z "$1" ]; then
    echo "Ошибка: Укажите путь к проекту rely-lead-processor"
    echo "Использование: $0 /path/to/rely-lead-processor"
    exit 1
fi

RELY_LEAD_PROCESSOR_PATH="$1"
METRICS_MODULE_SOURCE="$(dirname "$0")/metrics-module-template/src/metrics"

if [ ! -d "$RELY_LEAD_PROCESSOR_PATH" ]; then
    echo "Ошибка: Директория $RELY_LEAD_PROCESSOR_PATH не существует"
    exit 1
fi

if [ ! -d "$METRICS_MODULE_SOURCE" ]; then
    echo "Ошибка: Исходный модуль метрик не найден в $METRICS_MODULE_SOURCE"
    exit 1
fi

echo "=========================================="
echo "Установка модуля метрик в rely-lead-processor"
echo "=========================================="
echo "Путь к проекту: $RELY_LEAD_PROCESSOR_PATH"
echo "Источник модуля: $METRICS_MODULE_SOURCE"
echo ""

# Проверка структуры проекта
if [ ! -d "$RELY_LEAD_PROCESSOR_PATH/src" ]; then
    echo "Создание директории src..."
    mkdir -p "$RELY_LEAD_PROCESSOR_PATH/src"
fi

# Копирование модуля
echo "Копирование модуля метрик..."
cp -r "$METRICS_MODULE_SOURCE" "$RELY_LEAD_PROCESSOR_PATH/src/"

if [ $? -eq 0 ]; then
    echo "✅ Модуль успешно скопирован в $RELY_LEAD_PROCESSOR_PATH/src/metrics"
else
    echo "❌ Ошибка при копировании модуля"
    exit 1
fi

# Проверка package.json
if [ -f "$RELY_LEAD_PROCESSOR_PATH/package.json" ]; then
    echo ""
    echo "Проверка зависимостей в package.json..."
    
    # Проверка необходимых зависимостей
    REQUIRED_DEPS=("axios" "puppeteer" "csv-parse" "node-cron")
    MISSING_DEPS=()
    
    for dep in "${REQUIRED_DEPS[@]}"; do
        if ! grep -q "\"$dep\"" "$RELY_LEAD_PROCESSOR_PATH/package.json"; then
            MISSING_DEPS+=("$dep")
        fi
    done
    
    if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
        echo "⚠️  Отсутствуют зависимости: ${MISSING_DEPS[*]}"
        echo "   Установите их командой: npm install ${MISSING_DEPS[*]}"
    else
        echo "✅ Все необходимые зависимости найдены"
    fi
else
    echo "⚠️  package.json не найден. Убедитесь, что проект инициализирован."
fi

echo ""
echo "=========================================="
echo "Следующие шаги:"
echo "=========================================="
echo "1. Установите зависимости (если нужно):"
echo "   cd $RELY_LEAD_PROCESSOR_PATH"
echo "   npm install axios puppeteer csv-parse node-cron"
echo "   npm install --save-dev @types/node-cron"
echo ""
echo "2. Интегрируйте модуль в главное приложение:"
echo "   Добавьте в src/app.ts или src/index.ts:"
echo ""
echo "   import metricsModule from './metrics';"
echo "   app.use('/api/metrics', metricsModule.routes);"
echo "   metricsModule.scheduler.start();"
echo ""
echo "3. Настройте переменные окружения в .env:"
echo "   ABC_METRICS_API_URL=https://abc-metrics.fly.dev"
echo "   ABC_METRICS_API_KEY=your-api-key"
echo "   WORKIZ_API_KEY=your-workiz-api-key"
echo "   WORKIZ_API_SECRET=your-workiz-api-secret"
echo "   WORKIZ_API_URL=https://api.workiz.com"
echo "   ELOCAL_USERNAME=help@bostonmasters.com"
echo "   ELOCAL_PASSWORD=your-password"
echo ""
echo "4. Перезапустите приложение"
echo "=========================================="



