/**
 * inject.js - 注入BGA页面上下文 (MAIN world)
 * 直接访问 gameui.gamedatas 获取游戏数据
 */
(function () {
  'use strict';

  const MSG_PREFIX = 'CARCA_HELPER_';

  /**
   * 从 DOM 中扫描已放置的地块ID（备用数据源）
   * BGA 卡卡颂每个已放置地块的 DOM 元素有 id 类似 "tile_XX" 或 data 属性
   */
  function scanPlayedTilesFromDOM() {
    const playedIds = [];

    // 方法1: 查找 board 上的地块元素
    const tileElements = document.querySelectorAll('#board .bdtile, #board .tile, [id^="tile_"]');
    tileElements.forEach(el => {
      // 尝试从 id 属性提取地块编号
      const match = el.id && el.id.match(/tile[_-]?(\d+)/i);
      if (match) {
        playedIds.push(parseInt(match[1], 10));
      }
      // 尝试从 data 属性提取
      if (el.dataset && el.dataset.tileId) {
        playedIds.push(parseInt(el.dataset.tileId, 10));
      }
    });

    return playedIds;
  }

  /**
   * 提取 .tile_art 的 sprite sheet 背景图 URL
   */
  function extractSpriteSheetUrl() {
    // 尝试从已有的 tile_art 元素获取背景图
    const tileArt = document.querySelector('.tile_art');
    if (tileArt) {
      const style = window.getComputedStyle(tileArt);
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        return bgImage; // 返回完整的 url(...) 值
      }
    }

    // 尝试从 first_edition 版本获取
    const firstEdTileArt = document.querySelector('.tile_art.first_edition');
    if (firstEdTileArt) {
      const style = window.getComputedStyle(firstEdTileArt);
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        return bgImage;
      }
    }

    // 尝试从样式表中查找
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText && rule.selectorText.includes('.tile_art')) {
            const bg = rule.style.backgroundImage;
            if (bg && bg !== 'none') {
              return bg;
            }
          }
        }
      } catch (e) {
        // 跨域样式表无法访问，忽略
      }
    }

    return null;
  }

  /**
   * 提取 first_edition 的 sprite sheet 背景图 URL
   */
  function extractFirstEditionSpriteUrl() {
    const firstEdTileArt = document.querySelector('.tile_art.first_edition');
    if (firstEdTileArt) {
      const style = window.getComputedStyle(firstEdTileArt);
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        return bgImage;
      }
    }

    // 尝试从样式表中查找
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules || []) {
          if (rule.selectorText && rule.selectorText.includes('.tile_art') && rule.selectorText.includes('first_edition')) {
            const bg = rule.style.backgroundImage;
            if (bg && bg !== 'none') {
              return bg;
            }
          }
        }
      } catch (e) {
        // 跨域样式表无法访问，忽略
      }
    }

    return null;
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
      exp1: !!gd.exp1, // Inns & Cathedrals
      exp2: !!gd.exp2, // Traders & Builders
      exp3: !!gd.exp3, // Princess & Dragon
    };

    // 收集已放置的地块ID列表（从 gamedatas）
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

    // 合并两个来源，取并集（去重）
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

    // 提取 sprite sheet URL
    const spriteUrl = extractSpriteSheetUrl();
    const firstEdSpriteUrl = extractFirstEditionSpriteUrl();

    // 检测页面是否使用 first_edition
    const isFirstEdition = !!document.querySelector('.tile_art.first_edition');

    return {
      tileData: gd.tile_data,         // 所有地块ID -> {type, image, image_firstedition, expansion}
      tileTypes: gd.tile_types,       // 地块类型结构定义
      playedTileIds: allPlayedIds,    // 已放置的地块ID（合并 gamedatas + DOM）
      handTileIds: handTileIds,       // 手牌地块ID
      deckSize: parseInt(gd.deck_size, 10) || 0,
      expansions: expansions,
      places: gd.places,              // 可放置位置
      spriteUrl: spriteUrl,           // sprite sheet 背景图 URL
      firstEdSpriteUrl: firstEdSpriteUrl, // first_edition 版 sprite sheet URL
      isFirstEdition: isFirstEdition, // 是否使用 first_edition 版本
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
    const maxAttempts = 60; // 30秒超时

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
      // 监听多种可能的地块放置通知
      const events = [
        'placeTile', 'tilePlaced', 'updateScore',
        'tileDrawn', 'newTurn', 'playerTurnStart',
        'onEnteringState', 'onLeavingState',
        // BGA 卡卡颂常用的通知名
        'playTile', 'tilePlacement', 'notif_tilePlaced',
        'notif_newTurn',
      ];
      for (const evt of events) {
        try {
          dojo.subscribe(evt, function () {
            setTimeout(sendGameData, 300);
          });
        } catch (e) {
          // 某些事件可能不存在，忽略
        }
      }
    }

    // 方式2: 使用MutationObserver监听更广范围的DOM变化
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
          // 有新 DOM 节点添加
          if (m.addedNodes.length > 0) {
            shouldUpdate = true;
            break;
          }
          // 属性变化（比如 class/style 变化可能表示地块放置）
          if (m.type === 'attributes') {
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

    // 方式3: 定时轮询（兜底策略，缩短到 2 秒）
    setInterval(sendGameData, 2000);

    // 方式4: 拦截 BGA 的 AJAX 请求来检测游戏状态变化
    interceptAjax();
  }

  /**
   * 拦截 AJAX 请求以检测游戏状态更新
   */
  function interceptAjax() {
    // 拦截 XMLHttpRequest
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

    // 拦截 fetch
    const origFetch = window.fetch;
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

  // 响应content script的数据请求
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === MSG_PREFIX + 'REQUEST_DATA') {
      sendGameData();
    }
  });

  // 启动
  waitForGameUI();
})();
