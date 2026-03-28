/**
 * inject.js - 注入BGA页面上下文 (MAIN world)
 * 直接访问 gameui.gamedatas 获取游戏数据
 */
(function () {
  'use strict';

  const MSG_PREFIX = 'CARCA_HELPER_';

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

    // 收集已放置的地块ID列表
    const playedTileIds = [];
    if (gd.tiles) {
      for (const key in gd.tiles) {
        if (gd.tiles.hasOwnProperty(key)) {
          playedTileIds.push(parseInt(key, 10));
        }
      }
    }

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

    return {
      tileData: gd.tile_data,       // 所有地块ID -> {type, image, image_firstedition, expansion}
      tileTypes: gd.tile_types,     // 地块类型结构定义
      playedTileIds: playedTileIds, // 已放置的地块ID
      handTileIds: handTileIds,     // 手牌地块ID
      deckSize: parseInt(gd.deck_size, 10) || 0,
      expansions: expansions,
      places: gd.places,            // 可放置位置
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
      // 监听地块放置通知
      dojo.subscribe('placeTile', function () {
        setTimeout(sendGameData, 300);
      });
      dojo.subscribe('tilePlaced', function () {
        setTimeout(sendGameData, 300);
      });
      dojo.subscribe('updateScore', function () {
        setTimeout(sendGameData, 300);
      });
    }

    // 方式2: 使用MutationObserver监听DOM变化（作为备选）
    const boardEl = document.getElementById('board');
    if (boardEl) {
      const observer = new MutationObserver(function (mutations) {
        for (const m of mutations) {
          if (m.addedNodes.length > 0) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1 && node.classList && node.classList.contains('bdtile')) {
                setTimeout(sendGameData, 500);
                return;
              }
            }
          }
        }
      });
      observer.observe(boardEl, { childList: true, subtree: true });
    }

    // 方式3: 定时轮询（兜底策略）
    setInterval(sendGameData, 5000);
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
