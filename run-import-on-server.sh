#!/bin/bash
# Скрипт для запуска импорта на Fly.io сервере

export FLYCTL_INSTALL="/Users/rgareev91/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

echo "=== Загрузка файлов на сервер ==="
flyctl sftp shell -a abc-metrics << 'SFTP_EOF'
put Import-2025-12-16T13_58_55.706Z.csv
put import-workiz-jobs-csv.ts
quit
SFTP_EOF

echo ""
echo "=== Запуск импорта на сервере ==="
echo "Выполните следующие команды в интерактивной SSH сессии:"
echo ""
echo "flyctl ssh console -a abc-metrics"
echo ""
echo "Затем на сервере выполните:"
echo "  ls -lh Import-2025-12-16T13_58_55.706Z.csv import-workiz-jobs-csv.ts"
echo "  npm run import-jobs-csv Import-2025-12-16T13_58_55.706Z.csv"
echo ""


