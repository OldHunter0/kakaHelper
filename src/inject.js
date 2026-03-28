/**
 * inject.js - 注入BGA页面上下文 (MAIN world)
 * 直接访问 gameui.gamedatas 获取游戏数据
 */
(function () {
  'use strict';

  const MSG_PREFIX = 'CARCA_HELPER_';

  /**
   * 从 DOM 中扫描已放置的地块ID（备用数据源）
   */
  function scanPlayedTilesFromDOM() {
    const playedIds = [];
    // 查找 board 上的各种地块元素
    const selectors = [
      '#board .bdtile',
      '#board .tile',
      '[id^="tile_"]',
      '[id^="placedtile_"]',
      '.tileContainer',
    ];
    const tileElements = document.querySelectorAll(selectors.join(','));
    tileElements.forEach(el => {
      const match = el.id && el.id.match(/(?:tile|placedtile)[_-]?(\d+)/i);
      if (match) {
        playedIds.push(parseInt(match[1], 10));
      }
      if (el.dataset && el.dataset.tileId) {
        playedIds.push(parseInt(el.dataset.tileId, 10));
      }
    });
    return playedIds;
  }

  /**
   * 提取 .tile_art 元素的实际 CSS 样式
   */
  function extractTileArtStyles() {
    const info = {
      backgroundImage: null,
      backgroundSize: null,
      firstEdBackgroundImage: null,
      firstEdBackgroundSize: null,
    };

    // 常规 tile_art
    const tileArt = document.querySelector('.tile_art:not(.first_edition)');
    if (tileArt) {
      const style = window.getComputedStyle(tileArt);
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        info.backgroundImage = style.backgroundImage;
        info.backgroundSize = style.backgroundSize;
      }
    }

    // first_edition tile_art
    const firstEdArt = document.querySelector('.tile_art.first_edition');
    if (firstEdArt) {
      const style = window.getComputedStyle(firstEdArt);
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        info.firstEdBackgroundImage = style.backgroundImage;
        info.firstEdBackgroundSize = style.backgroundSize;
      }
    }

    // 如果从元素取不到，尝试从样式表中查找
    if (!info.backgroundImage) {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (!rule.selectorText) continue;
            if (rule.selectorText.includes('.tile_art') &&
              !rule.selectorText.includes('first_edition')) {
              const bg = rule.style.backgroundImage;
              const sz = rule.style.backgroundSize;
              if (bg && bg !== 'none') {
                info.backgroundImage = bg;
                if (sz) info.backgroundSize = sz;
              }
            }
            if (rule.selectorText.includes('first_edition')) {
              const bg = rule.style.backgroundImage;
              const sz = rule.style.backgroundSize;
              if (bg && bg !== 'none') {
                info.firstEdBackgroundImage = bg;
                if (sz) info.firstEdBackgroundSize = sz;
              }
            }
          }
        } catch (e) { /* 跨域 */ }
      }
    }

    return info;
  }

  /**
   * 从页面上已有的 .tile_art 元素提取已知的 background-position 映射
   * 这能帮助我们确认 sprite sheet 的排列方式
   */
  function extractKnownSpritePositions() {
    const positions = {};
    // 查找页面上所有 tile_art，尝试将它们与 tile id 关联
    document.querySelectorAll('.tile_art').forEach(el => {
      const style = window.getComputedStyle(el);
      const bgPos = style.backgroundPosition;

      // 尝试找到关联的 tile id
      const parent = el.closest('[id]');
      if (parent && parent.id) {
        const match = parent.id.match(/(\d+)/);
        if (match) {
          positions[match[1]] = bgPos;
        }
      }
    });
    return positions;
  }

  /**
   * 从 gameui.gamedatas 提取游戏数据
   */
  function extractGameData() {
    if (typeof gameui === 'undefined' || !gameui || !gameui.gamedatas) {
      return null;
    }

    const gd = gameui.gamedatas;

    // 判断当前启用了哪些扩展包
    const expansions = {
      base: true,
      exp1: !!gd.exp1,
      exp2: !!gd.exp2,
      exp3: !!gd.exp3,
    };

    // 确定活动的扩展包ID集合
    const activeExpansionIds = new Set([0]); // 基础版始终包含
    if (gd.exp1) activeExpansionIds.add(1);
    if (gd.exp2) activeExpansionIds.add(2);
    if (gd.exp3) activeExpansionIds.add(3);
    activeExpansionIds.add(9); // 河流数据包含但在显示时排除

    // 过滤 tile_data：只保留当前游戏活动扩展包的地块
    const filteredTileData = {};
    let maxImgIndex = 0;
    let maxFirstEdImgIndex = 0;

    if (gd.tile_data) {
      for (const tileId in gd.tile_data) {
        if (gd.tile_data.hasOwnProperty(tileId)) {
          const td = gd.tile_data[tileId];
          const exp = parseInt(td.expansion, 10);
          if (activeExpansionIds.has(exp)) {
            filteredTileData[tileId] = td;

            const img = parseInt(td.image, 10);
            if (!isNaN(img) && img > maxImgIndex) maxImgIndex = img;

            if (td.image_firstedition !== undefined && td.image_firstedition !== null) {
              const imgFe = parseInt(td.image_firstedition, 10);
              if (!isNaN(imgFe) && imgFe > maxFirstEdImgIndex) maxFirstEdImgIndex = imgFe;
            }
          }
        }
      }
    }

    // 收集已放置的地块ID
    const playedTileIds = [];
    if (gd.tiles) {
      for (const key in gd.tiles) {
        if (gd.tiles.hasOwnProperty(key)) {
          playedTileIds.push(parseInt(key, 10));
        }
      }
    }

    // 备用：从 DOM 扫描已放置的地块
    const domPlayedIds = scanPlayedTilesFromDOM();
    const allPlayedIds = [...new Set([...playedTileIds, ...domPlayedIds])];

    // 收集手牌中的地块
    const handTileIds = [];
    if (gd.hand) {
      for (const key in gd.hand) {
        if (gd.hand.hasOwnProperty(key)) {
          const id = parseInt(gd.hand[key], 10) || parseInt(key, 10);
          if (id > 0) handTileIds.push(id);
        }
      }
    }

    // 提取 sprite sheet 样式信息
    const tileArtInfo = extractTileArtStyles();
    const isFirstEdition = !!document.querySelector('.tile_art.first_edition');

    // 计算 sprite sheet 的行列数
    const spriteCols = 12;
    const spriteRows = Math.ceil((maxImgIndex + 1) / spriteCols);
    const firstEdSpriteRows = Math.ceil((maxFirstEdImgIndex + 1) / spriteCols);

    // 提取已知位置映射（调试用，也帮助验证）
    const knownPositions = extractKnownSpritePositions();

    return {
      tileData: gd.tile_data,         // 所有地块ID -> {type, image, image_firstedition, expansion}
      tileTypes: gd.tile_types,       // 地块类型结构定义
      playedTileIds: allPlayedIds,    // 已放置的地块ID（合并 gamedatas + DOM）
      handTileIds: handTileIds,       // 手牌地块ID
      deckSize: parseInt(gd.deck_size, 10) || 0,
      expansions: expansions,
      places: gd.places,              // 可放置位置
      tilesDetail: gd.tiles,          // 已放置地块详情 {id, x, y, type, ori, ...}
      tileArtInfo: tileArtInfo,
      isFirstEdition: isFirstEdition,
      spriteCols: spriteCols,
      spriteRows: spriteRows,
      firstEdSpriteRows: firstEdSpriteRows,
      knownPositions: knownPositions,
    };
  }

  /**
   * 发送游戏数据到 content script
   */
  function sendGameData() {
    const data = extractGameData();
    if (data) {
      window.postMessage({
        type: MSG_PREFIX + 'GAME_DATA',
        payload: data,
      }, '*');
    }
  }

  /**
   * 等待 gameui 可用后发送初始数据
   */
  function waitForGameUI() {
    let attempts = 0;
    const maxAttempts = 60;

    const check = setInterval(() => {
      attempts++;
      if (typeof gameui !== 'undefined' && gameui && gameui.gamedatas && gameui.gamedatas.tile_data) {
        clearInterval(check);
        console.log('[卡卡颂助手] 游戏数据加载完成');
        sendGameData();
        startWatching();
      } else if (attempts >= maxAttempts) {
        clearInterval(check);
        console.log('[卡卡颂助手] 等待游戏数据超时');
      }
    }, 500);
  }

  /**
   * 监听游戏状态变化
   */
  function startWatching() {
    // 方式1: 监听BGA的通知系统
    if (typeof dojo !== 'undefined' && dojo.subscribe) {
      const events = [
        'placeTile', 'tilePlaced', 'updateScore',
        'tileDrawn', 'newTurn', 'playerTurnStart',
        'onEnteringState', 'onLeavingState',
        'playTile', 'tilePlacement',
        'notif_tilePlaced', 'notif_newTurn',
      ];
      for (const evt of events) {
        try {
          dojo.subscribe(evt, function () {
            setTimeout(sendGameData, 300);
          });
        } catch (e) { /* 忽略 */ }
      }
    }

    // 方式2: MutationObserver 监听更广范围的 DOM 变化
    const watchTargets = [
      document.getElementById('game_play_area'),
      document.getElementById('game_play_area_wrap'),
      document.getElementById('board'),
      document.getElementById('carcassonne_board'),
    ].filter(Boolean);

    if (watchTargets.length > 0) {
      const observer = new MutationObserver(function (mutations) {
        let shouldUpdate = false;
        for (const m of mutations) {
          if (m.addedNodes.length > 0 || m.type === 'attributes') {
            shouldUpdate = true;
            break;
          }
        }
        if (shouldUpdate) {
          setTimeout(sendGameData, 500);
        }
      });

      for (const target of watchTargets) {
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style'],
        });
      }
    }

    // 方式3: 定时轮询（兜底策略，2 秒）
    setInterval(sendGameData, 2000);

    // 方式4: 拦截 AJAX 请求
    interceptAjax();

    // 方式5: 设置棋盘空位悬浮监听
    setupBoardHoverListeners();
  }

  /**
   * 拦截 AJAX 请求以检测游戏状态更新
   */
  function interceptAjax() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._carcaUrl = url;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      const self = this;
      if (self._carcaUrl && typeof self._carcaUrl === 'string' &&
        self._carcaUrl.includes('carcassonne')) {
        self.addEventListener('load', function () {
          setTimeout(sendGameData, 500);
        });
      }
      return origSend.apply(this, arguments);
    };

    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (input) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        const result = origFetch.apply(this, arguments);
        if (url.includes('carcassonne')) {
          result.then(() => {
            setTimeout(sendGameData, 500);
          }).catch(() => { });
        }
        return result;
      };
    }
  }

  /**
   * 设置棋盘空位悬浮监听
   * BGA 卡卡颂的空位 DOM: 监听 #board 区域的鼠标移动，
   * 检查是否悬浮在空位上，通过 postMessage 通知 content.js
   */
  function setupBoardHoverListeners() {
    let lastHoverKey = null;
    let hoverListenerActive = false;

    function startHoverWatch() {
      if (hoverListenerActive) return;
      hoverListenerActive = true;

      // 使用事件委托监听整个 board 区域
      const boardEl = document.getElementById('board') || document.getElementById('game_play_area');
      if (!boardEl) return;

      boardEl.addEventListener('mouseover', function (e) {
        // 查找空位元素：BGA 空位通常是 class 含 "place" 或 id 含 "place" 的元素
        const placeEl = e.target.closest('[id^="place_"], .place, [id^="tile_place"]');
        if (!placeEl) {
          // 也尝试匹配含坐标信息的空位元素
          const coordEl = e.target.closest('[data-x][data-y]');
          if (coordEl && !coordEl.querySelector('.tile_art')) {
            handlePlaceHover(coordEl, e);
            return;
          }
          return;
        }
        handlePlaceHover(placeEl, e);
      });

      boardEl.addEventListener('mouseout', function (e) {
        const placeEl = e.target.closest('[id^="place_"], .place, [id^="tile_place"], [data-x][data-y]');
        if (placeEl || !e.relatedTarget || !boardEl.contains(e.relatedTarget)) {
          if (lastHoverKey) {
            lastHoverKey = null;
            window.postMessage({
              type: MSG_PREFIX + 'LEAVE_PLACE',
            }, '*');
          }
        }
      });
    }

    function handlePlaceHover(el, e) {
      // 尝试从元素属性获取坐标
      let x, y;

      // 方法1：从 data 属性
      if (el.dataset && el.dataset.x !== undefined) {
        x = parseInt(el.dataset.x, 10);
        y = parseInt(el.dataset.y, 10);
      }
      // 方法2：从 id 解析 (如 "place_1_0" 或 "tile_place_1_-1")
      if (x === undefined && el.id) {
        const match = el.id.match(/place_?(-?\d+)_(-?\d+)/);
        if (match) {
          x = parseInt(match[1], 10);
          y = parseInt(match[2], 10);
        }
      }
      // 方法3：从 style 中的 left/top 和 board 尺寸反推坐标
      if (x === undefined) {
        // 使用 places 数据和元素位置来匹配
        const gd = (typeof gameui !== 'undefined' && gameui && gameui.gamedatas) ? gameui.gamedatas : null;
        if (gd && gd.places) {
          // 获取元素在 board 中的相对位置并匹配最近的 place
          const rect = el.getBoundingClientRect();
          const boardRect = (document.getElementById('board') || el.parentElement).getBoundingClientRect();
          // 无法精确反推，跳过
        }
      }

      if (x !== undefined && y !== undefined) {
        const key = x + ',' + y;
        if (key !== lastHoverKey) {
          lastHoverKey = key;
          window.postMessage({
            type: MSG_PREFIX + 'HOVER_PLACE',
            payload: {
              x: x,
              y: y,
              mouseX: e.clientX,
              mouseY: e.clientY,
            },
          }, '*');
        }
      }
    }

    startHoverWatch();

    // 也尝试定时重新绑定（棋盘可能延迟加载）
    setTimeout(startHoverWatch, 3000);
    setTimeout(startHoverWatch, 8000);
  }

  // 响应 content script 的数据请求
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === MSG_PREFIX + 'REQUEST_DATA') {
      sendGameData();
    }
  });

  // 启动
  waitForGameUI();
})();
