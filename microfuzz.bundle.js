/*
  Vendored minimal browser bundle of @nozbe/microfuzz 1.0.0
  Exposes window.Microfuzz = { createFuzzySearch, fuzzyMatch }
  Source based on node_modules/@nozbe/microfuzz/dist/* (MIT License)
*/
(function(){
  'use strict';
  // normalizeText.js
  var diacriticsRegex = /[\u0300-\u036f]/g;
  var regexŁ = /ł/g;
  var regexÑ = /ñ/g;
  function normalizeText(string){
    return string
      .toLowerCase()
      .normalize('NFD').replace(diacriticsRegex, '')
      .replace(regexŁ, 'l').replace(regexÑ, 'n')
      .trim();
  }

  // impl.js (selected parts)
  var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
  var sortByScore = function(a, b){ return a.score - b.score; };
  var sortRangeTuple = function(a, b){ return a[0] - b[0]; };
  var validWordBoundaries = new Set('  []()-–—\'"“”'.split(''));
  function isValidWordBoundary(character){ return validWordBoundaries.has(character); }

  function matchesFuzzily(item, normalizedItem, itemWords, query, normalizedQuery, queryWords, strategy){
    if (item === query) { return [0, [[0, item.length - 1]]]; }
    var queryLen = query.length;
    var normalizedItemLen = normalizedItem.length;
    var normalizedQueryLen = normalizedQuery.length;
    if (normalizedItem === normalizedQuery) { return [0.1, [[0, normalizedItemLen - 1]]]; }
    if (normalizedItem.startsWith(normalizedQuery)) { return [0.5, [[0, normalizedQueryLen - 1]]]; }
    var index = normalizedItem.indexOf(normalizedQuery);
    if (index !== -1) {
      var startsWithWord = index === 0 || isValidWordBoundary(item[index - 1]);
      return [startsWithWord ? 1 : 2, [[index, index + normalizedQueryLen - 1]]];
    }
    var score = 3;
    var itemIndex = -1;
    var prevItemIndex = -1;
    var highlightRanges = [];
    var currentHighlightRange = null;
    var i = 0;
    var j = 0;
    var consecutive = 0;
    var wordsMatch = true;

    if (queryWords.length > 1) {
      for (var w = 0; w < queryWords.length; w++) {
        var word = queryWords[w];
        if (word && !itemWords.has(word)) { wordsMatch = false; break; }
      }
      if (wordsMatch) { return [1.5, null]; }
    }

    while (i < normalizedItemLen && j < normalizedQueryLen) {
      var itemChar = normalizedItem[i];
      var queryChar = normalizedQuery[j];
      if (itemChar === queryChar) {
        if (currentHighlightRange) {
          currentHighlightRange[1] = i;
        } else {
          currentHighlightRange = [i, i];
          highlightRanges.push(currentHighlightRange);
        }
        if (i === itemIndex + 1) {
          consecutive += 1;
          score -= 0.025 + Math.min(consecutive * 0.01, 0.01);
        } else {
          consecutive = 0;
        }
        if (i <= 2) {
          score -= (2 - i) * 0.03;
        }
        if (i === 0 || isValidWordBoundary(item[i - 1])) {
          score -= 0.1;
        }
        prevItemIndex = itemIndex;
        itemIndex = i;
        i += 1;
        j += 1;
      } else {
        if (currentHighlightRange) { currentHighlightRange = null; }
        i += 1;
      }
    }

    if (j !== normalizedQueryLen) { return null; }

    var chunkCount = highlightRanges.length;
    score += Math.max(0, chunkCount - 1) * 0.01;
    score += Math.max(0, (itemIndex - prevItemIndex) - 1) * 0.0001;

    var isShortMatch = itemIndex - (highlightRanges[0] ? highlightRanges[0][0] : itemIndex) < 4;
    if (isShortMatch) { score -= 0.01; }

    highlightRanges.sort(sortRangeTuple);
    return [score, highlightRanges];
  }

  function fuzzyMatchImpl(text, query){
    var normalizedQuery = normalizeText(query);
    var queryWords = normalizedQuery.split(' ');
    var normalizedText = normalizeText(text);
    var itemWords = new Set(normalizedText.split(' '));
    var result = matchesFuzzily(text, normalizedText, itemWords, query, normalizedQuery, queryWords, 'smart');
    if (result) {
      return { item: text, score: result[0], matches: [ result[1] ] };
    }
    return null;
  }

  function createFuzzySearchImpl(collection, options){
    var strategy = (options && options.strategy) || 'aggressive';
    var getText = options && options.getText;
    var preprocessedCollection = collection.map(function(element){
      var texts;
      if (getText) {
        texts = getText(element);
      } else {
        var text = options && options.key ? element[options.key] : element;
        texts = [text];
      }
      var preprocessedTexts = texts.map(function(text){
        var originalText = text || '';
        var normalized = normalizeText(originalText);
        var words = new Set(normalized.split(' '));
        return [originalText, normalized, words];
      });
      return [element, preprocessedTexts];
    });

    return function(queryText){
      var normalizedQuery = normalizeText(queryText || '');
      var queryWords = normalizedQuery.split(' ');
      var results = [];
      for (var idx = 0; idx < preprocessedCollection.length; idx++) {
        var element = preprocessedCollection[idx][0];
        var texts = preprocessedCollection[idx][1];
        var bestScore = MAX_SAFE_INTEGER;
        var matches = [];
        for (var t = 0; t < texts.length; t++) {
          var originalText = texts[t][0];
          var normalized = texts[t][1];
          var words = texts[t][2];
          var m = matchesFuzzily(originalText, normalized, words, queryText, normalizedQuery, queryWords, strategy);
          if (m) {
            var score = m[0];
            if (score < bestScore) { bestScore = score; }
            matches[t] = m[1] || null;
          } else {
            matches[t] = null;
          }
        }
        if (bestScore !== MAX_SAFE_INTEGER) {
          results.push({ item: element, score: bestScore, matches: matches });
        }
      }
      results.sort(sortByScore);
      return results;
    };
  }

  function createFuzzySearch(list, options){
    return createFuzzySearchImpl(list, options || {});
  }

  var api = { createFuzzySearch: createFuzzySearch, fuzzyMatch: fuzzyMatchImpl };
  try {
    window.Microfuzz = api;
  } catch(_) {}
})();