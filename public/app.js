// Главная страница - список таблиц
if (document.getElementById('tables-tbody')) {
    loadTables();

    const downloadTablesBtn = document.getElementById('download-tables-csv-btn');
    if (downloadTablesBtn) {
        downloadTablesBtn.onclick = () => {
            window.location.href = '/api/tables/csv';
        };
    }
}

// Страница просмотра таблицы
if (document.getElementById('table-name')) {
    loadTable();
}

async function loadTables() {
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const tablesList = document.getElementById('tables-list');
    const tbody = document.getElementById('tables-tbody');

    try {
        loading.style.display = 'block';
        error.style.display = 'none';
        tablesList.style.display = 'none';

        const response = await fetch('/api/tables');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        tbody.innerHTML = '';

        if (data.tables && data.tables.length > 0) {
            data.tables.forEach(table => {
                const row = document.createElement('tr');
                const lastUpdatedText = table.lastUpdated
                    ? formatDateTime(new Date(table.lastUpdated))
                    : '—';
                row.innerHTML = `
                    <td><a href="/table.html?name=${encodeURIComponent(table.name)}">${escapeHtml(table.name)}</a></td>
                    <td>${formatNumber(table.rowCount)}</td>
                    <td>${lastUpdatedText}</td>
                `;
                tbody.appendChild(row);
            });

            tablesList.style.display = 'block';
        } else {
            tbody.innerHTML = '<tr><td colspan="3">Таблицы не найдены</td></tr>';
            tablesList.style.display = 'block';
        }

        loading.style.display = 'none';
    } catch (err) {
        loading.style.display = 'none';
        error.textContent = `Ошибка загрузки: ${err.message}`;
        error.style.display = 'block';
    }
}

async function loadTable() {
    const urlParams = new URLSearchParams(window.location.search);
    const tableName = urlParams.get('name');

    if (!tableName) {
        showError('Имя таблицы не указано');
        return;
    }

    // Валидация имени таблицы
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        showError('Некорректное имя таблицы');
        return;
    }

    const page = parseInt(urlParams.get('page') || '1', 10);
    const limit = 100;

    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const tableInfo = document.getElementById('table-info');
    const tableContainer = document.getElementById('table-container');
    const tableNameEl = document.getElementById('table-name');
    const totalRowsEl = document.getElementById('total-rows');
    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const pagination = document.getElementById('pagination');

    tableNameEl.textContent = tableName;

    // Show import button only for calls table
    const importSection = document.getElementById('import-section');
    const csvFileInput = document.getElementById('csv-file-input');
    const importBtn = document.getElementById('import-btn');

    if (tableName === 'calls' && importSection && csvFileInput && importBtn) {
        importSection.style.display = 'inline-block';

        // Setup import functionality
        let selectedFile = null;

        csvFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                selectedFile = e.target.files[0];
                if (!selectedFile.name.endsWith('.csv')) {
                    showError('Пожалуйста, выберите CSV файл');
                    selectedFile = null;
                    return;
                }
            }
        });

        importBtn.addEventListener('click', () => {
            if (!selectedFile) {
                csvFileInput.click();
            } else {
                importCalls(selectedFile);
            }
        });

        csvFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                selectedFile = e.target.files[0];
                if (selectedFile.name.endsWith('.csv')) {
                    importCalls(selectedFile);
                } else {
                    showError('Пожалуйста, выберите CSV файл');
                }
            }
        });

        async function importCalls(file) {
            importBtn.disabled = true;
            importBtn.textContent = 'Импорт...';

            const formData = new FormData();
            formData.append('csv', file);

            try {
                const response = await fetch('/api/import/calls-csv', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.message || 'Ошибка при импорте');
                }

                // Handle streaming response
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const data = JSON.parse(line);
                                if (data.progress) {
                                    console.log(`Progress: ${data.progress}% - ${data.message}`);
                                }
                                if (data.result) {
                                    if (data.result.success) {
                                        alert(`Импорт завершен!\nИмпортировано: ${data.result.imported}\nПропущено: ${data.result.skipped}`);
                                        // Reload table data
                                        loadTable();
                                    } else {
                                        showError(data.result.message || 'Ошибка при импорте');
                                    }
                                }
                            } catch (e) {
                                // Skip invalid JSON lines
                            }
                        }
                    }
                }
            } catch (error) {
                showError(error.message || 'Ошибка при импорте');
            } finally {
                importBtn.disabled = false;
                importBtn.textContent = '📥 Импорт CSV';
                selectedFile = null;
                csvFileInput.value = '';
            }
        }
    } else if (importSection) {
        importSection.style.display = 'none';
    }

    // Setup download functionality
    const downloadBtn = document.getElementById('download-csv-btn');
    if (downloadBtn) {
        downloadBtn.onclick = () => {
            window.location.href = `/api/table/${encodeURIComponent(tableName)}/csv`;
        };
    }

    try {
        loading.style.display = 'block';
        error.style.display = 'none';
        tableInfo.style.display = 'none';
        tableContainer.style.display = 'none';

        const response = await fetch(`/api/table/${encodeURIComponent(tableName)}?page=${page}&limit=${limit}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        totalRowsEl.textContent = formatNumber(data.totalRows);
        tableInfo.style.display = 'block';

        // Сохраняем данные для сортировки
        let currentData = {
            columns: data.columns || [],
            rows: data.rows || [],
            sortColumn: null,
            sortDirection: 'asc' // 'asc' или 'desc'
        };

        // Функция сортировки строк
        function sortTableRows(columnIndex, direction) {
            const rows = Array.from(tableBody.querySelectorAll('tr'));
            const rowsData = rows.map(tr => ({
                element: tr,
                cells: Array.from(tr.querySelectorAll('td'))
            }));

            rowsData.sort((a, b) => {
                const aValue = a.cells[columnIndex]?.textContent || '';
                const bValue = b.cells[columnIndex]?.textContent || '';

                // Обработка NULL значений
                if (aValue === 'NULL') return direction === 'asc' ? 1 : -1;
                if (bValue === 'NULL') return direction === 'asc' ? -1 : 1;
                if (aValue === 'NULL' && bValue === 'NULL') return 0;

                // Попытка определить тип данных
                const aNum = parseFloat(aValue);
                const bNum = parseFloat(bValue);
                const aDate = new Date(aValue);
                const bDate = new Date(bValue);

                // Числовое сравнение
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return direction === 'asc' ? aNum - bNum : bNum - aNum;
                }

                // Дата сравнение
                if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
                    return direction === 'asc' ? aDate - bDate : bDate - aDate;
                }

                // Строковое сравнение
                const comparison = aValue.localeCompare(bValue, 'ru', { numeric: true, sensitivity: 'base' });
                return direction === 'asc' ? comparison : -comparison;
            });

            // Перезаполняем tbody отсортированными строками
            tableBody.innerHTML = '';
            rowsData.forEach(rowData => {
                tableBody.appendChild(rowData.element);
            });
        }

        // Функция обновления индикаторов сортировки
        function updateSortIndicators(activeColumnIndex) {
            const thElements = tableHead.querySelectorAll('th');
            thElements.forEach((th, index) => {
                // Удаляем все индикаторы
                const existingIndicator = th.querySelector('.sort-indicator');
                if (existingIndicator) {
                    existingIndicator.remove();
                }
                th.classList.remove('sort-asc', 'sort-desc');

                // Добавляем индикатор для активного столбца
                if (index === activeColumnIndex) {
                    const indicator = document.createElement('span');
                    indicator.className = 'sort-indicator';
                    indicator.textContent = currentData.sortDirection === 'asc' ? ' ↑' : ' ↓';
                    th.appendChild(indicator);
                    th.classList.add(`sort-${currentData.sortDirection}`);
                }
            });
        }

        // Создание заголовков таблицы с обработчиками сортировки
        if (data.columns && data.columns.length > 0) {
            const headRow = document.createElement('tr');
            data.columns.forEach((column, columnIndex) => {
                const th = document.createElement('th');
                th.textContent = column;
                th.style.cursor = 'pointer';
                th.title = 'Кликните для сортировки';

                th.addEventListener('click', (e) => {
                    // Если пользователь выделил текст, не сортируем
                    const selection = window.getSelection();
                    if (selection.toString().length > 0) {
                        return;
                    }
                    // Определяем направление сортировки
                    if (currentData.sortColumn === columnIndex) {
                        // Переключаем направление если клик на тот же столбец
                        currentData.sortDirection = currentData.sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        // Новый столбец - начинаем с возрастающей сортировки
                        currentData.sortColumn = columnIndex;
                        currentData.sortDirection = 'asc';
                    }

                    // Сортируем таблицу
                    sortTableRows(columnIndex, currentData.sortDirection);

                    // Обновляем индикаторы
                    updateSortIndicators(columnIndex);
                });

                headRow.appendChild(th);
            });
            tableHead.innerHTML = '';
            tableHead.appendChild(headRow);
        }

        // Заполнение данными
        tableBody.innerHTML = '';
        if (data.rows && data.rows.length > 0) {
            data.rows.forEach(row => {
                const tr = document.createElement('tr');
                data.columns.forEach(column => {
                    const td = document.createElement('td');
                    const value = row[column];
                    if (value === null || value === undefined) {
                        td.textContent = 'NULL';
                        td.style.color = '#999';
                        td.style.fontStyle = 'italic';
                    } else if (typeof value === 'object') {
                        td.textContent = JSON.stringify(value);
                        td.style.fontFamily = 'monospace';
                        td.style.fontSize = '0.9em';
                    } else {
                        td.textContent = String(value);
                    }
                    tr.appendChild(td);
                });
                tableBody.appendChild(tr);
            });
        } else {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = data.columns.length;
            td.textContent = 'Нет данных';
            td.style.textAlign = 'center';
            td.style.padding = '40px';
            td.style.color = '#999';
            tr.appendChild(td);
            tableBody.appendChild(tr);
        }

        tableContainer.style.display = 'block';

        // Пагинация
        const totalPages = Math.ceil(data.totalRows / limit);
        if (totalPages > 1) {
            const pageInfo = document.getElementById('page-info');
            const prevBtn = document.getElementById('prev-page');
            const nextBtn = document.getElementById('next-page');

            pageInfo.textContent = `Страница ${page} из ${totalPages}`;

            prevBtn.disabled = page <= 1;
            nextBtn.disabled = page >= totalPages;

            prevBtn.onclick = () => {
                if (page > 1) {
                    window.location.href = `/table.html?name=${encodeURIComponent(tableName)}&page=${page - 1}`;
                }
            };

            nextBtn.onclick = () => {
                if (page < totalPages) {
                    window.location.href = `/table.html?name=${encodeURIComponent(tableName)}&page=${page + 1}`;
                }
            };

            pagination.style.display = 'flex';
        } else {
            pagination.style.display = 'none';
        }

        loading.style.display = 'none';
    } catch (err) {
        loading.style.display = 'none';
        showError(`Ошибка загрузки: ${err.message}`);
    }
}

function showError(message) {
    const error = document.getElementById('error');
    error.textContent = message;
    error.style.display = 'block';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    return new Intl.NumberFormat('ru-RU').format(num);
}

function formatDateTime(date) {
    if (!date || isNaN(date.getTime())) {
        return '—';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Форматируем дату и время
    const dateStr = date.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const timeStr = date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });

    // Добавляем относительное время
    let relativeTime = '';
    if (diffMins < 1) {
        relativeTime = ' (только что)';
    } else if (diffMins < 60) {
        relativeTime = ` (${diffMins} мин назад)`;
    } else if (diffHours < 24) {
        relativeTime = ` (${diffHours} ч назад)`;
    } else if (diffDays < 7) {
        relativeTime = ` (${diffDays} дн назад)`;
    }

    return `${dateStr} ${timeStr}${relativeTime}`;
}


