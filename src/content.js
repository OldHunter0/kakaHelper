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
    /** 缓存 sprite sheet URL（从 inject.js 获取） */
    let cachedSpriteUrl = null;
    let cachedFirstEdSpriteUrl = null;
    let cachedIsFirstEdition = false;

    /* ────────── 地块逻辑 ────────── */

    /**
     * 判断一个地块边上的特征类型
     * @param {Object} tileType - tile_types 中的类型定义
     * @param {number} edge - 边编号 1=北 2=东 3=南 4=西
     * @returns {'C'|'R'|'F'} 城市/道路/田地
     */
    function getEdgeType(tileType, edge) {
        // 检查城市
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.link && c.link.includes(edge)) return 'C';
            }
        }
        // 检查道路
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
     * 获取地块类型的中文描述
     */
    function getTileDescription(tileType) {
        const edges = getEdgeSignature(tileType);
        const parts = [];

        // 城市
        const cityEdges = edges.split('').filter(e => e === 'C').length;
        if (cityEdges > 0) parts.push(`城×${cityEdges}`);

        // 道路
        const roadEdges = edges.split('').filter(e => e === 'R').length;
        if (roadEdges > 0) parts.push(`路×${roadEdges}`);

        // 修道院
        if (tileType.abbey && !Array.isArray(tileType.abbey) && Object.keys(tileType.abbey).length > 0) {
            parts.push('修道院');
        }

        // 特殊标记
        if (tileType.city && !Array.isArray(tileType.city)) {
            for (const cKey in tileType.city) {
                const c = tileType.city[cKey];
                if (c.bonus) parts.push('🛡');
                if (c.cathedral) parts.push('⛪');
                if (c.princess) parts.push('👸');
                if (c.good) parts.push('📦');
            }
        }
        if (tileType.road && !Array.isArray(tileType.road)) {
            for (const rKey in tileType.road) {
                if (tileType.road[rKey].inn) { parts.push('🏨'); break; }
            }
        }
        if (tileType.volcano) parts.push('🌋');
        if (tileType.portal) parts.push('🌀');

        return parts.join(' ') || '田地';
    }

    /**
     * 计算各类型地块的剩余数量
     */
    function calculateRemaining(data) {
        const { tileData, tileTypes, playedTileIds, handTileIds } = data;

        // 1. 按type分组统计总数
        const typeTotal = {};  // type -> total count
        const typeTiles = {};  // type -> [tileId, ...]
        const typeInfo = {};   // type -> {image, image_firstedition, expansion}

        for (const tileId in tileData) {
            const td = tileData[tileId];
            const type = td.type;

            if (!typeTotal[type]) {
                typeTotal[type] = 0;
                typeTiles[type] = [];
                typeInfo[type] = {
                    image: td.image,
                    image_firstedition: td.image_firstedition,
                    expansion: td.expansion,
                };
            }
            typeTotal[type]++;
            typeTiles[type].push(parseInt(tileId, 10));
        }

        // 2. 统计已使用的（已放置 + 手牌中）
        const usedIds = new Set([...playedTileIds, ...handTileIds]);

        // 3. 计算剩余
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
     * BGA sprite sheet 排列：12列布局
     */
    function getSpritePosition(imageIndex) {
        const cols = 12;
        const col = imageIndex % cols;
        const row = Math.floor(imageIndex / cols);
        // background-position 百分比公式: index / (total-1) * 100
        const xPercent = (cols > 1) ? (col / (cols - 1)) * 100 : 0;
        // 行数假设足够
        const yPercent = (row > 0) ? (row / 3) * 100 : 0; // 假设4行
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

        // 拖拽功能
        makeDraggable(panelElement, document.getElementById('carca-header'));

        // 折叠功能
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

        // 更新缓存的 sprite 信息
        if (data.spriteUrl) cachedSpriteUrl = data.spriteUrl;
        if (data.firstEdSpriteUrl) cachedFirstEdSpriteUrl = data.firstEdSpriteUrl;
        if (data.isFirstEdition !== undefined) cachedIsFirstEdition = data.isFirstEdition;

        const remaining = calculateRemaining(data);
        const tileTypes = data.tileTypes;

        // 更新牌堆信息（排除河流地块）
        const deckInfo = document.getElementById('carca-deck-info');
        const totalRemaining = Object.values(remaining)
            .filter(r => r.expansion !== 9) // 排除河流
            .reduce((s, r) => s + r.remaining, 0);
        deckInfo.textContent = `剩余: ${totalRemaining}`;

        // 按扩展包分组
        const expansionNames = {
            0: '基础版',
            1: '客栈与大教堂',
            2: '商人与建筑师',
            3: '公主与龙',
            9: '河流',
        };

        // 收集当前游戏中使用的扩展包（排除河流 expansion=9）
        const expansionGroups = {};
        for (const type in remaining) {
            const exp = remaining[type].expansion;
            // 河流地块是游戏开始时自动铺设的，不在牌堆中抽取，排除
            if (exp === 9) continue;
            if (!expansionGroups[exp]) expansionGroups[exp] = [];
            expansionGroups[exp].push({ type: parseInt(type, 10), ...remaining[type] });
        }

        // 构建过滤器
        const filterEl = document.getElementById('carca-filter');
        filterEl.innerHTML = '';
        const expKeys = Object.keys(expansionGroups).sort((a, b) => a - b);

        // 验证当前 filter 是否依然有效
        if (currentFilter !== 'all' && !expKeys.includes(String(currentFilter))) {
            currentFilter = 'all';
        }

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
        } else if (expKeys.length === 1) {
            // 只有一个扩展包时，不显示过滤器，重置 filter
            currentFilter = 'all';
        }

        // 构建地块网格
        const gridEl = document.getElementById('carca-grid');
        gridEl.innerHTML = '';

        for (const exp of expKeys) {
            const group = expansionGroups[exp];
            // 按type排序
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

                // 地块缩略图
                const thumb = document.createElement('div');
                thumb.className = 'carca-tile-thumb';

                const isFirstEdition = cachedIsFirstEdition;
                const imgIndex = isFirstEdition ? item.image_firstedition : item.image;

                if (imgIndex !== undefined) {
                    const tileArt = document.createElement('div');
                    tileArt.className = 'carca-tile-thumb-art';

                    // 使用从 inject.js 获取的 sprite URL（不依赖 BGA CSS 类）
                    const spriteUrlToUse = isFirstEdition
                        ? (cachedFirstEdSpriteUrl || cachedSpriteUrl)
                        : cachedSpriteUrl;

                    if (spriteUrlToUse) {
                        tileArt.style.backgroundImage = spriteUrlToUse;
                    } else {
                        // 回退：尝试使用 BGA 的 CSS 类
                        tileArt.className += ' tile_art' + (isFirstEdition ? ' first_edition' : '');
                    }

                    tileArt.style.backgroundPosition = getSpritePosition(imgIndex);
                    tileArt.style.backgroundSize = '1200% auto';
                    tileArt.style.width = '100%';
                    tileArt.style.height = '100%';
                    tileArt.style.position = 'absolute';
                    tileArt.style.top = '0';
                    tileArt.style.left = '0';
                    thumb.appendChild(tileArt);
                }

                // 边类型标识 (N-E-S-W)
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

                tilesRow.appendChild(card);
            }

            section.appendChild(tilesRow);
            gridEl.appendChild(section);
        }

        // 恢复过滤器选择
        if (currentFilter !== 'all') {
            filterByExpansion(currentFilter);
        }
    }

    function filterByExpansion(exp) {
        // 保存用户选择
        currentFilter = exp;

        // 更新按钮状态
        document.querySelectorAll('.carca-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.exp === String(exp));
        });

        // 显示/隐藏对应的section
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

    // 定时请求刷新（兜底，缩短到 3 秒）
    setInterval(function () {
        window.postMessage({ type: MSG_PREFIX + 'REQUEST_DATA' }, '*');
    }, 3000);

})();
