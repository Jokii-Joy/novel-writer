window.__ModuleLoader__.load({
  id: '@local/novel-writer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /** Shared namespace every part file writes into. Parts are concatenated into this scope. */
    const NW = {
      React,
      h,
      CSS_PARTS: [],
      version: '1.0.0',
    };
    NW.ReactDOM = null;
