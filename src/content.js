/**
 * content.js - Content Script (ISOLATED world)
 * 接收inject.js的游戏数据，管理UI面板
 */
(function () {
    'use strict';

    const MSG_PREFIX = 'CARCA_HELPER_';
    let currentData = null;
    let panelElement = null;
    /** 记住用户选择的过滤器 */
    let currentFilter = 'all';
    /** 缓存 sprite sheet 样式信息 */
    let cachedTileArtInfo = null;
    let cachedIsFirstEdition = false;
    let cachedSpriteCols = 12;
    let cachedSpriteRows = 13;
    let cachedFirstEdSpriteRows = 7;

    /* ────────── 地块逻辑 ────────── */

    /**
     * 判断一个地块边上的特征类型
     * @param {Object} tileType - tile_types 中的类型定义
     * @param {number} edge - 边编号 1=北 2=东 3=南 4=西
     * @returns {'C'|'R'|'F'} 城市/道路/田地
     */
    function getEdgeType(tileType, edge) {
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.link && c.link.includes(edge)) return 'C';
            }
        }
        if (tileType.road && !Array.isArray(tileType.road)) {
            for (const rKey in tileType.road) {
                const r = tileType.road[rKey];
                if (r.link && r.link.includes(edge)) return 'R';
            }
        }
        return 'F';
    }

    /**
     * 获取地块的4条边类型描述
     */
    function getEdgeSignature(tileType) {
        return [1, 2, 3, 4].map(e => getEdgeType(tileType, e)).join('');
    }

    /**
     * 将边类型字母转为中文符号用于显示
     */
    function edgeCharToChinese(ch) {
        switch (ch) {
            case 'C': return '城';
            case 'R': return '路';
            case 'F': return '田';
            default: return ch;
        }
    }

    /**
     * 获取地块类型的简短中文描述
     */
    function getTileShortDesc(tileType) {
        if (!tileType) return '?';
        const edges = getEdgeSignature(tileType);
        // 按 北→东→南→西 顺序显示边类型的中文
        const edgeStr = edges.split('').map(edgeCharToChinese).join('');

        const specials = [];
        // 修道院
        if (tileType.abbey && !Array.isArray(tileType.abbey) && Object.keys(tileType.abbey).length > 0) {
            specials.push('修');
        }
        // 城市特殊标记
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.bonus) { specials.push('🛡'); break; }
            }
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.cathedral) { specials.push('⛪'); break; }
            }
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.princess) { specials.push('👸'); break; }
            }
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.good) { specials.push('📦'); break; }
            }
        }
        // 道路特殊标记
        if (tileType.road && !Array.isArray(tileType.road)) {
            for (const rKey in tileType.road) {
                if (tileType.road[rKey].inn) { specials.push('🏨'); break; }
            }
        }
        if (tileType.volcano) specials.push('🌋');
        if (tileType.portal) specials.push('🌀');

        return specials.length > 0 ? edgeStr + ' ' + specials.join('') : edgeStr;
    }

    /**
     * 获取地块类型的完整描述（用于 tooltip）
     */
    function getTileDescription(tileType) {
        const edges = getEdgeSignature(tileType);
        const parts = [];

        const cityEdges = edges.split('').filter(e => e === 'C').length;
        if (cityEdges > 0) parts.push(`城×${cityEdges}`);
        const roadEdges = edges.split('').filter(e => e === 'R').length;
        if (roadEdges > 0) parts.push(`路×${roadEdges}`);
        if (tileType.abbey && !Array.isArray(tileType.abbey) && Object.keys(tileType.abbey).length > 0) {
            parts.push('修道院');
        }
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.bonus) parts.push('盾牌');
                if (c.cathedral) parts.push('大教堂');
                if (c.princess) parts.push('公主');
                if (c.good) parts.push('货物');
            }
        }
        if (tileType.road && !Array.isArray(tileType.road)) {
            for (const rKey in tileType.road) {
                if (tileType.road[rKey].inn) { parts.push('客栈'); break; }
            }
        }
        if (tileType.volcano) parts.push('火山');
        if (tileType.portal) parts.push('传送门');
        return `北${edgeCharToChinese(edges[0])} 东${edgeCharToChinese(edges[1])} 南${edgeCharToChinese(edges[2])} 西${edgeCharToChinese(edges[3])}` +
            (parts.length > 0 ? '\n' + parts.join(' ') : '');
    }

    /**
     * 计算各类型地块的剩余数量
     */
    function calculateRemaining(data) {
        const { tileData, tileTypes, playedTileIds, handTileIds } = data;

        const typeTotal = {};
        const typeTiles = {};
        const typeInfo = {};

        for (const tileId in tileData) {
            const td = tileData[tileId];
            const type = td.type;

            if (!typeTotal[type]) {
                typeTotal[type] = 0;
                typeTiles[type] = [];
                typeInfo[type] = {
                    image: parseInt(td.image, 10),
                    image_firstedition: td.image_firstedition !== undefined ? parseInt(td.image_firstedition, 10) : undefined,
                    expansion: parseInt(td.expansion, 10),
                };
            }
            typeTotal[type]++;
            typeTiles[type].push(parseInt(tileId, 10));
        }

        const usedIds = new Set([...playedTileIds, ...handTileIds]);

        const typeRemaining = {};
        for (const type in typeTotal) {
            const tiles = typeTiles[type];
            const usedCount = tiles.filter(id => usedIds.has(id)).length;
            typeRemaining[type] = {
                total: typeTotal[type],
                used: usedCount,
                remaining: typeTotal[type] - usedCount,
                expansion: typeInfo[type].expansion,
                image: typeInfo[type].image,
                image_firstedition: typeInfo[type].image_firstedition,
            };
        }

        return typeRemaining;
    }

    /* ────────── sprite sheet 图片定位 ────────── */

    /**
     * 计算 background-position 百分比
     * @param {number} imageIndex - sprite sheet 中的图片索引
     * @param {number} totalRows - sprite sheet 总行数
     */
    function getSpritePosition(imageIndex, totalRows) {
        const cols = cachedSpriteCols;
        const col = imageIndex % cols;
        const row = Math.floor(imageIndex / cols);
        const xPercent = (cols > 1) ? (col / (cols - 1)) * 100 : 0;
        const yPercent = (totalRows > 1) ? (row / (totalRows - 1)) * 100 : 0;
        return `${xPercent}% ${yPercent}%`;
    }

    /* ────────── UI 面板 ────────── */

    function createPanel() {
        if (panelElement) return panelElement;

        panelElement = document.createElement('div');
        panelElement.id = 'carca-helper-panel';
        panelElement.innerHTML = `
      <div class="carca-header" id="carca-header">
        <span class="carca-title">🏰 卡卡颂助手</span>
        <span class="carca-deck-info" id="carca-deck-info"></span>
        <button class="carca-toggle" id="carca-toggle">−</button>
      </div>
      <div class="carca-body" id="carca-body">
        <div class="carca-filter" id="carca-filter"></div>
        <div class="carca-grid" id="carca-grid"></div>
      </div>
    `;

        document.body.appendChild(panelElement);
        makeDraggable(panelElement, document.getElementById('carca-header'));

        document.getElementById('carca-toggle').addEventListener('click', function (e) {
            e.stopPropagation();
            const body = document.getElementById('carca-body');
            const btn = this;
            if (body.style.display === 'none') {
                body.style.display = '';
                btn.textContent = '−';
            } else {
                body.style.display = 'none';
                btn.textContent = '+';
            }
        });

        return panelElement;
    }

    function makeDraggable(panel, handle) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            panel.style.left = (startLeft + dx) + 'px';
            panel.style.top = (startTop + dy) + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', function () {
            isDragging = false;
        });
    }

    /**
     * 更新面板内容
     */
    function updatePanel(data) {
        createPanel();

        // 更新缓存
        if (data.tileArtInfo) cachedTileArtInfo = data.tileArtInfo;
        if (data.isFirstEdition !== undefined) cachedIsFirstEdition = data.isFirstEdition;
        if (data.spriteCols) cachedSpriteCols = data.spriteCols;
        if (data.spriteRows) cachedSpriteRows = data.spriteRows;
        if (data.firstEdSpriteRows) cachedFirstEdSpriteRows = data.firstEdSpriteRows;

        const remaining = calculateRemaining(data);
        const tileTypes = data.tileTypes;

        // 按扩展包分组（排除河流 expansion=9）
        const expansionNames = {
            0: '基础版',
            1: '客栈与大教堂',
            2: '商人与建筑师',
            3: '公主与龙',
        };

        const expansionGroups = {};
        for (const type in remaining) {
            const exp = remaining[type].expansion;
            // 排除河流地块（expansion=9）
            if (exp === 9) continue;
            if (!expansionGroups[exp]) expansionGroups[exp] = [];
            expansionGroups[exp].push({ type: parseInt(type, 10), ...remaining[type] });
        }

        const expKeys = Object.keys(expansionGroups).sort((a, b) => parseInt(a) - parseInt(b));

        // 更新牌堆信息
        const deckInfo = document.getElementById('carca-deck-info');
        let totalRemaining;
        if (currentFilter !== 'all' && expKeys.includes(String(currentFilter))) {
            // 过滤模式下显示当前过滤的剩余数量
            totalRemaining = (expansionGroups[currentFilter] || []).reduce((s, r) => s + r.remaining, 0);
        } else {
            totalRemaining = Object.values(expansionGroups)
                .flat()
                .reduce((s, r) => s + r.remaining, 0);
        }
        deckInfo.textContent = `剩余: ${totalRemaining}`;

        // 验证当前 filter 是否仍然有效
        if (currentFilter !== 'all' && !expKeys.includes(String(currentFilter))) {
            currentFilter = 'all';
        }

        // 构建过滤器按钮
        const filterEl = document.getElementById('carca-filter');
        filterEl.innerHTML = '';

        if (expKeys.length > 1) {
            const allBtn = document.createElement('button');
            allBtn.className = 'carca-filter-btn' + (currentFilter === 'all' ? ' active' : '');
            allBtn.textContent = '全部';
            allBtn.dataset.exp = 'all';
            allBtn.addEventListener('click', () => filterByExpansion('all'));
            filterEl.appendChild(allBtn);

            for (const exp of expKeys) {
                const btn = document.createElement('button');
                btn.className = 'carca-filter-btn' + (String(currentFilter) === String(exp) ? ' active' : '');
                btn.textContent = expansionNames[exp] || `扩展${exp}`;
                btn.dataset.exp = exp;
                btn.addEventListener('click', () => filterByExpansion(exp));
                filterEl.appendChild(btn);
            }
        } else {
            // 只有一个扩展包时，不显示过滤器
            currentFilter = 'all';
        }

        // 构建地块网格
        const gridEl = document.getElementById('carca-grid');
        gridEl.innerHTML = '';

        // 检查是否有可用的 sprite 样式
        const hasSpriteStyle = cachedTileArtInfo && (
            cachedTileArtInfo.backgroundImage ||
            cachedTileArtInfo.firstEdBackgroundImage
        );

        for (const exp of expKeys) {
            const group = expansionGroups[exp];
            group.sort((a, b) => a.type - b.type);

            const section = document.createElement('div');
            section.className = 'carca-section';
            section.dataset.exp = exp;

            if (expKeys.length > 1) {
                const sectionTitle = document.createElement('div');
                sectionTitle.className = 'carca-section-title';
                sectionTitle.textContent = expansionNames[exp] || `扩展${exp}`;
                section.appendChild(sectionTitle);
            }

            const tilesRow = document.createElement('div');
            tilesRow.className = 'carca-tiles-row';

            for (const item of group) {
                const tileType = tileTypes[item.type];
                const card = document.createElement('div');
                card.className = 'carca-tile-card' + (item.remaining === 0 ? ' depleted' : '');
                card.title = tileType ? getTileDescription(tileType) : `类型 ${item.type}`;

                // 地块缩略图区域
                const thumb = document.createElement('div');
                thumb.className = 'carca-tile-thumb';

                const isFirstEdition = cachedIsFirstEdition;
                const imgIndex = isFirstEdition ? item.image_firstedition : item.image;
                const totalRows = isFirstEdition ? cachedFirstEdSpriteRows : cachedSpriteRows;

                // 尝试渲染 sprite 图片
                let spriteRendered = false;
                if (imgIndex !== undefined && !isNaN(imgIndex) && hasSpriteStyle) {
                    const tileArt = document.createElement('div');
                    tileArt.className = 'carca-tile-thumb-art';

                    // 使用从 inject.js 获取的实际 CSS
                    const bgImage = isFirstEdition
                        ? (cachedTileArtInfo.firstEdBackgroundImage || cachedTileArtInfo.backgroundImage)
                        : cachedTileArtInfo.backgroundImage;
                    const bgSize = isFirstEdition
                        ? (cachedTileArtInfo.firstEdBackgroundSize || cachedTileArtInfo.backgroundSize)
                        : cachedTileArtInfo.backgroundSize;

                    if (bgImage && bgImage !== 'none') {
                        tileArt.style.backgroundImage = bgImage;
                        if (bgSize) {
                            tileArt.style.backgroundSize = bgSize;
                        }
                        tileArt.style.backgroundPosition = getSpritePosition(imgIndex, totalRows);
                        tileArt.style.width = '100%';
                        tileArt.style.height = '100%';
                        tileArt.style.position = 'absolute';
                        tileArt.style.top = '0';
                        tileArt.style.left = '0';
                        thumb.appendChild(tileArt);
                        spriteRendered = true;
                    }
                }

                // 如果无法渲染sprite：显示文字描述作为主要内容
                if (!spriteRendered && tileType) {
                    const textDesc = document.createElement('div');
                    textDesc.className = 'carca-tile-text-desc';
                    const sig = getEdgeSignature(tileType);
                    // 用颜色编码的方位文字
                    textDesc.innerHTML = formatEdgeVisual(sig, tileType);
                    thumb.appendChild(textDesc);
                }

                // 边类型标识（始终显示，重叠在图片上方）
                if (tileType) {
                    const edgeLabel = document.createElement('div');
                    edgeLabel.className = 'carca-edge-label';
                    const sig = getEdgeSignature(tileType);
                    edgeLabel.textContent = sig;
                    thumb.appendChild(edgeLabel);
                }

                card.appendChild(thumb);

                // 数量显示
                const count = document.createElement('div');
                count.className = 'carca-tile-count';
                count.innerHTML = `<span class="carca-remaining">${item.remaining}</span><span class="carca-total">/${item.total}</span>`;
                card.appendChild(count);

                // 简短描述文字（始终显示在卡片底部，帮助识别地块）
                if (tileType) {
                    const descEl = document.createElement('div');
                    descEl.className = 'carca-tile-desc';
                    descEl.textContent = getTileShortDesc(tileType);
                    card.appendChild(descEl);
                }

                tilesRow.appendChild(card);
            }

            section.appendChild(tilesRow);
            gridEl.appendChild(section);
        }

        // 恢复过滤器选择
        if (currentFilter !== 'all') {
            applyFilter(currentFilter);
        }
    }

    /**
     * 创建边类型的可视化 HTML（无sprite时显示在缩略图区域）
     */
    function formatEdgeVisual(sig, tileType) {
        const colorMap = { C: '#e74c3c', R: '#f39c12', F: '#27ae60' };
        const nameMap = { C: '城', R: '路', F: '田' };

        let html = '<div class="carca-edge-visual">';
        // 北
        html += `<div class="ev-n" style="color:${colorMap[sig[0]]}">${nameMap[sig[0]]}</div>`;
        // 西 + 中心 + 东
        html += `<div class="ev-middle">`;
        html += `<span class="ev-w" style="color:${colorMap[sig[3]]}">${nameMap[sig[3]]}</span>`;

        // 中心显示特殊标记
        const specials = [];
        if (tileType.abbey && !Array.isArray(tileType.abbey) && Object.keys(tileType.abbey).length > 0) specials.push('修');
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.bonus) { specials.push('🛡'); break; }
            }
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.cathedral) { specials.push('⛪'); break; }
            }
        }
        if (tileType.road && !Array.isArray(tileType.road)) {
            for (const rKey in tileType.road) {
                if (tileType.road[rKey].inn) { specials.push('🏨'); break; }
            }
        }
        html += `<span class="ev-center">${specials.join('') || '·'}</span>`;
        html += `<span class="ev-e" style="color:${colorMap[sig[1]]}">${nameMap[sig[1]]}</span>`;
        html += `</div>`;
        // 南
        html += `<div class="ev-s" style="color:${colorMap[sig[2]]}">${nameMap[sig[2]]}</div>`;
        html += '</div>';
        return html;
    }

    function filterByExpansion(exp) {
        currentFilter = exp;

        document.querySelectorAll('.carca-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.exp === String(exp));
        });

        applyFilter(exp);

        // 更新剩余数量显示
        if (currentData) {
            const remaining = calculateRemaining(currentData);
            const deckInfo = document.getElementById('carca-deck-info');
            let totalRemaining;
            if (exp === 'all') {
                totalRemaining = Object.values(remaining)
                    .filter(r => r.expansion !== 9)
                    .reduce((s, r) => s + r.remaining, 0);
            } else {
                totalRemaining = Object.values(remaining)
                    .filter(r => r.expansion === parseInt(exp, 10))
                    .reduce((s, r) => s + r.remaining, 0);
            }
            deckInfo.textContent = `剩余: ${totalRemaining}`;
        }
    }

    function applyFilter(exp) {
        document.querySelectorAll('.carca-section').forEach(section => {
            if (exp === 'all') {
                section.style.display = '';
            } else {
                section.style.display = section.dataset.exp === String(exp) ? '' : 'none';
            }
        });
    }

    /* ────────── 消息监听 ────────── */

    window.addEventListener('message', function (event) {
        if (event.data && event.data.type === MSG_PREFIX + 'GAME_DATA') {
            currentData = event.data.payload;
            updatePanel(currentData);
        }
    });

    // 初始请求数据
    setTimeout(function () {
        window.postMessage({ type: MSG_PREFIX + 'REQUEST_DATA' }, '*');
    }, 1000);

    // 定时请求刷新（兜底，3 秒）
    setInterval(function () {
        window.postMessage({ type: MSG_PREFIX + 'REQUEST_DATA' }, '*');
    }, 3000);

})();
