/**
 * dsh-icp-query — DSH Client half.
 *
 * Declares the conversation card for the bundle's two wire tools (`icp_query`
 * and `icp_query_types`) by registering keyed views into the shipped
 * `tool.call.toolview` slot. The markup and CSS follow the shipped Tool rows
 * (disclosure head: glyph · title · summary · stat suffix, expandable details
 * body built from the details-card primitive) and only use `--dsw-alias-*`
 * theme tokens, so the card matches the host in both themes.
 *
 * Data source: the Host half's `output.presentationMeta` — durable card facts
 * stored with the tool result — so a folded card keeps its content after a
 * spill or a session fork. Older results without those facts fall back to the
 * plain model-facing text inside the shipped I/O panel.
 */
window.__ModuleLoader__.load({
  id: 'dsh-icp-query',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace registered by this Client half. */
    const NS = 'dsh-icp';

    const DICT = {
      en: {
        'tool.query': 'ICP filing lookup',
        'tool.types': 'ICP lookup types',
        'tool.preparing': 'Preparing…',
        'tool.running': 'running',
        'tool.failed': 'failed',
        'tool.stopped': 'Stopped',
        'tool.stoppedNote': 'This call was stopped before it produced a complete result.',
        'tool.type': 'type',
        'tool.keyword': 'keyword',
        'tool.paging': 'paging',
        'tool.pagingValue': 'page {page} / {pages} · {size} per page · {total} total',
        'tool.blacklistApi': 'violation list (single record)',
        'tool.elapsed': 'elapsed',
        'tool.unit': 'unit',
        'tool.nature': 'nature',
        'tool.mainLicence': 'main licence',
        'tool.serviceLicence': 'service licence',
        'tool.recordTime': 'approved',
        'tool.level': 'threat level',
        'tool.detailsFetched': 'App / mini-program details merged from the official detail endpoint.',
        'tool.noRecords': 'No filing records found.',
        'tool.rowsTruncated': 'Only the first 10 records are kept in the card; the full list is in the result.',
        'tool.spilled': 'The full result was spilled to disk; this card shows the durable preview.',
        'tool.output': 'Output',
        'tool.errorOutput': 'Error',
        'tool.nextPage': 'next page: {page}',
        'tool.count': '{count} types',
        'tool.recordCount': '{count} records',
        'tool.endpoint': 'endpoint',
        'tool.config': 'effective config',
        'tool.configCaptcha': 'captcha attempts',
        'tool.configTimeout': 'request timeout',
        'tool.configPageSize': 'max page size',
        'tool.configDetailConc': 'detail concurrency',
        'tool.configDetails': 'details merged',
        'tool.on': 'on',
        'tool.off': 'off',
        'tool.blacklist': 'blacklist, not paged',
        'tool.paged': 'paged',
        'tool.searchHint': 'search: {hint}',
      },
      zh: {
        'tool.query': 'ICP 备案查询',
        'tool.types': 'ICP 查询类型',
        'tool.preparing': '准备中…',
        'tool.running': '执行中',
        'tool.failed': '失败',
        'tool.stopped': '已停止',
        'tool.stoppedNote': '本次调用已停止，没有完整结果。',
        'tool.type': '类型',
        'tool.keyword': '关键词',
        'tool.paging': '分页',
        'tool.pagingValue': '第 {page} / {pages} 页 · 每页 {size} 条 · 共 {total} 条',
        'tool.blacklistApi': '违法违规名单（单条）',
        'tool.elapsed': '耗时',
        'tool.unit': '主办单位',
        'tool.nature': '性质',
        'tool.mainLicence': '主体备案号',
        'tool.serviceLicence': '服务备案号',
        'tool.recordTime': '审核时间',
        'tool.level': '威胁等级',
        'tool.detailsFetched': '已按官方详情接口补全 APP / 小程序 / 快应用详情。',
        'tool.noRecords': '未查询到备案记录。',
        'tool.rowsTruncated': '卡片只保留前 10 条记录，完整列表见查询结果。',
        'tool.spilled': '结果过大已落盘（spill），卡片显示的是持久化预览。',
        'tool.output': '输出',
        'tool.errorOutput': '错误',
        'tool.nextPage': '下一页：{page}',
        'tool.count': '{count} 种类型',
        'tool.recordCount': '{count} 条',
        'tool.endpoint': '接口',
        'tool.config': '当前生效配置',
        'tool.configCaptcha': '验证码尝试',
        'tool.configTimeout': '请求超时',
        'tool.configPageSize': '单页上限',
        'tool.configDetailConc': '详情并发',
        'tool.configDetails': '补全详情',
        'tool.on': '开启',
        'tool.off': '关闭',
        'tool.blacklist': '黑名单，不分页',
        'tool.paged': '可分页',
        'tool.searchHint': 'search：{hint}',
      },
    };

    /** Best-effort locale for the module-level fallback translator. */
    function detectLocale() {
      try {
        const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
        return lang.startsWith('zh') ? 'zh' : 'en';
      } catch {
        return 'en';
      }
    }

    /** Substitute `{name}` placeholders. */
    function format(template, params) {
      let text = template;
      for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value));
      return text;
    }

    /** Local dictionary fallback used when the page does not supply `t`. */
    function fallbackTranslate(key, params) {
      const dict = DICT[detectLocale()] ?? DICT.en;
      const template = dict[key] ?? DICT.en[key] ?? key;
      return params === undefined ? template : format(template, params);
    }

    /** Translate through the page's bound `t`, falling back to our own dictionary. */
    function makeTranslator(bound) {
      if (typeof bound !== 'function') return fallbackTranslate;
      return (key, params) => {
        let value;
        try {
          value = params === undefined ? bound(key) : bound(key, params);
        } catch {
          return fallbackTranslate(key, params);
        }
        if (typeof value !== 'string' || value === key) return fallbackTranslate(key, params);
        return params === undefined ? value : format(value, params);
      };
    }

    /* -------------------------------------------------------------- */
    /* Tool-block readers                                             */
    /* -------------------------------------------------------------- */

    /** Shorten a display string to `max` code points. */
    function clip(value, max) {
      const text = value === null || value === undefined ? '' : String(value);
      const chars = Array.from(text);
      return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
    }

    /** Printable cell: never `undefined`/`null`/empty. */
    function cellValue(value) {
      if (value === null || value === undefined) return '—';
      const text = String(value).trim();
      return text === '' ? '—' : text;
    }

    /** Parse the model arguments of one tool block at any call stage. */
    function blockArgs(block) {
      if (block === null || block === undefined) return null;
      const raw = typeof block.kind === 'string' ? block.call?.argsRaw : block.argsRaw;
      if (typeof raw !== 'string' || raw === '') return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }

    /** Join every text block of one settled tool result. */
    function blockText(block) {
      const content = block !== null && block !== undefined && Array.isArray(block.content) ? block.content : [];
      return content
        .filter((entry) => entry !== null && typeof entry === 'object' && entry.type === 'text' && typeof entry.text === 'string')
        .map((entry) => entry.text)
        .join('\n');
    }

    /** Durable card facts persisted as `result.meta` by `output.presentationMeta`. */
    function blockMeta(block) {
      const meta = block === null || block === undefined ? undefined : block.meta;
      return meta !== null && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.kind === 'string' ? meta : null;
    }

    /** Whether the settled content is a spill locator rather than the render body. */
    function contentSpilled(block) {
      return /Full formatted result stored at|结果已落盘/u.test(blockText(block));
    }

    /** One failed-call message without the `Error: ` envelope. */
    function blockError(block) {
      return blockText(block).replace(/^Error:\s*/u, '');
    }

    /* -------------------------------------------------------------- */
    /* Shipped primitives ported for the card body                    */
    /* -------------------------------------------------------------- */

    /** One `dt`/`dd` block of a details card (rows without a value are skipped). */
    function fieldList(fields) {
      const rows = fields
        .filter((field) => field !== null && field !== undefined)
        .map((field, index) =>
          h(
            'div',
            { key: index, className: 'ict_detailsField' },
            h('dt', null, field.label),
            h(
              'dd',
              null,
              field.mono === true && typeof field.value === 'string'
                ? h('span', { className: 'ict_mono' }, field.value)
                : field.value === null || field.value === undefined
                  ? '—'
                  : field.value,
            ),
          ),
        );
      return rows.length === 0 ? null : h('dl', { className: 'ict_detailsFields' }, ...rows);
    }

    /** Heading line of a details item. */
    function detailHeading(text) {
      return h('div', { className: 'ict_detailsHeading' }, h('span', { className: 'ict_detailsText' }, text));
    }

    /** Secondary line of a details item. */
    function detailSubtitle(text) {
      return h('div', { className: 'ict_detailsSubtitle' }, text);
    }

    /** Caption line of a details item. */
    function detailDescription(text) {
      return h('div', { className: 'ict_detailsDescription' }, text);
    }

    /** One bordered details card. */
    function detailsCard(items) {
      const rows = items.filter((nodes) => nodes.filter((node) => node !== null && node !== undefined).length > 0);
      if (rows.length === 0) return null;
      return h(
        'div',
        { className: 'ict_detailsCard' },
        h(
          'ul',
          { className: 'ict_detailsList' },
          ...rows.map((nodes, index) =>
            h('li', { key: index, className: 'ict_detailsItem' }, ...nodes.filter((node) => node !== null && node !== undefined)),
          ),
        ),
      );
    }

    /** Shipped Input/Output panel: raw text for failures and legacy results. */
    function ioCard(label, text, isError) {
      return h(
        'div',
        { className: 'ict_ioCard' },
        h(
          'div',
          { className: 'ict_ioSection' },
          h('span', { className: 'ict_ioLabel' }, label),
          h('span', { className: 'ict_ioText', 'data-error': isError ? 'true' : undefined }, text),
        ),
      );
    }

    /** One trailing notice under a card. */
    function cardNote(text, tone) {
      return h('div', { className: 'ict_note', 'data-tone': tone }, text);
    }

    /* -------------------------------------------------------------- */
    /* Icons and head text                                            */
    /* -------------------------------------------------------------- */

    /** Official 16x16 outline glyph; the shipped rows use a 1px regular stroke. */
    function outlineIcon(nodes, size, className, key) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          strokeWidth: 1,
          className,
          key,
        },
        ...nodes,
      );
    }

    /** One stroked outline path of an official glyph. */
    function outlinePath(d, extra) {
      return h('path', { d, stroke: 'currentColor', ...(extra === undefined ? {} : extra) });
    }

    /** Disclosure chevron; `open` points it up like the shipped rows. */
    function chevronIcon(open, className, key) {
      return outlineIcon(
        [
          open
            ? outlinePath('M12 10L8.70711 6.70711C8.31658 6.31658 7.68342 6.31658 7.29289 6.70711L4 10')
            : outlinePath('M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6'),
        ],
        14,
        className,
        key,
      );
    }

    /** Glyph of one ICP wire tool: filing document + magnifier, or a flat list. */
    function toolIcon(toolName) {
      if (toolName === 'icp_query') {
        return outlineIcon(
          [
            outlinePath('M8.5 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h5'),
            outlinePath('M8.5 1.5L12 5v2.5'),
            outlinePath('M8.5 1.5V5H12'),
            outlinePath('M5 6.5h3M5 9h2'),
            outlinePath('M11.2 13.9a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z'),
            outlinePath('M13.3 13.3 14.6 14.6', { strokeLinecap: 'round' }),
          ],
          14,
        );
      }
      return outlineIcon(
        [
          outlinePath('M6 3.5h7.5M6 8h7.5M6 12.5h7.5', { strokeLinecap: 'round' }),
          outlinePath('M2.6 3.5h.01M2.6 8h.01M2.6 12.5h.01', { strokeLinecap: 'round' }),
        ],
        14,
      );
    }

    /** Localized title of one ICP wire tool. */
    function toolTitle(t, toolName) {
      return toolName === 'icp_query' ? t('tool.query') : t('tool.types');
    }

    /** One text run of the collapsed head; `masked` renders it for the shimmer sweep. */
    function headText(masked, className, value, key) {
      const shared = `ict_shimmerText ${className}`;
      return masked
        ? h('span', { key, className: shared, 'data-shimmer-text': value })
        : h('span', { key, className: shared }, value);
    }

    /** Running-state sweep copied from the shipped tool row. */
    function shimmerLine(props) {
      const active = props.active === true;
      return h(
        'span',
        { className: 'ict_shimmer', 'data-shimmer': active ? '' : undefined },
        h('span', { className: 'ict_shimmerContent' }, props.render(false)),
        active
          ? h(
              'span',
              { className: 'ict_shimmerDecoration', 'aria-hidden': 'true', inert: '' },
              h(
                'span',
                { className: 'ict_shimmerSweep' },
                h('span', { className: 'ict_shimmerContent ict_shimmerHighlight' }, props.render(true)),
              ),
            )
          : null,
      );
    }

    /** `label · value` summary used by the running head from parsed arguments. */
    function argsSummary(t, toolName, args) {
      if (args === null) return '';
      if (toolName === 'icp_query') {
        const search = typeof args.search === 'string' ? args.search.trim() : '';
        const type = typeof args.type === 'string' ? args.type : '';
        if (search === '' && type === '') return '';
        return clip(type === '' ? search : `${type} · ${search}`, 72);
      }
      return '';
    }

    /* -------------------------------------------------------------- */
    /* Card model                                                     */
    /* -------------------------------------------------------------- */

    /** Collapsed-head facts of one settled `icp_query` card. */
    function queryHead(t, model) {
      const label = typeof model.label === 'string' && model.label !== '' ? model.label : String(model.type ?? '');
      const search = typeof model.search === 'string' ? model.search : '';
      const rows = Array.isArray(model.rows) ? model.rows : [];
      const blacklist = model.blacklist === true || model.pageSize === 0;
      const summary = search === '' ? label : `${label} · ${search}`;
      if (blacklist) {
        const first = rows[0];
        const level = first !== null && typeof first === 'object' ? first.blackListLevel : undefined;
        const suffix =
          level === undefined || level === null || String(level) === ''
            ? t('tool.blacklist')
            : `${t('tool.level')} ${String(level)}`;
        return { summary: clip(summary, 72), suffix };
      }
      const total = Number.isFinite(model.total) ? model.total : null;
      const count = total !== null ? total : Number.isFinite(model.rowCount) ? model.rowCount : rows.length;
      const parts = [t('tool.recordCount', { count })];
      if (Number.isFinite(model.elapsedMs)) parts.push(`${model.elapsedMs} ms`);
      return { summary: clip(summary, 72), suffix: clip(parts.join(' · '), 48) };
    }

    /** Collapsed-head facts of one settled `icp_query_types` card. */
    function typesHead(t, model) {
      const count = Number.isFinite(model.count) ? model.count : Array.isArray(model.types) ? model.types.length : 0;
      return { summary: t('tool.count', { count }), suffix: '' };
    }

    /** Body of one settled `icp_query` call: request facts + filing records. */
    function queryBody(t, model) {
      const rows = Array.isArray(model.rows) ? model.rows : [];
      const blacklist = model.blacklist === true || model.pageSize === 0;
      const paging = blacklist
        ? t('tool.blacklistApi')
        : t('tool.pagingValue', {
            page: model.pageNum,
            pages: model.pages,
            size: model.pageSize,
            total: model.total,
          });
      const items = [
        [
          fieldList([
            { label: t('tool.type'), value: `${cellValue(model.label)}（${cellValue(model.type)}）` },
            { label: t('tool.keyword'), value: cellValue(model.search), mono: true },
            { label: t('tool.paging'), value: paging },
            Number.isFinite(model.elapsedMs) ? { label: t('tool.elapsed'), value: `${model.elapsedMs} ms` } : null,
          ]),
          typeof model.message === 'string' && model.message !== '' ? detailDescription(model.message) : null,
          model.detailsFetched === true ? detailDescription(t('tool.detailsFetched')) : null,
        ],
      ];
      for (const row of rows) {
        const target = row !== null && typeof row === 'object' ? row : {};
        const head =
          target.domain ?? target.domainName ?? target.serviceName ?? target.unitName ?? target.title ?? '';
        const state = blacklist
          ? [
              typeof target.blackListLevel !== 'undefined' && String(target.blackListLevel) !== ''
                ? `${t('tool.level')}: ${target.blackListLevel}`
                : '',
              typeof target.title === 'string' && target.title !== '' ? target.title : '',
            ]
              .filter((part) => part !== '')
              .join(' · ')
          : [
              typeof target.unitName === 'string' && target.unitName !== '' ? `${t('tool.unit')}: ${target.unitName}` : '',
              typeof target.natureName === 'string' && target.natureName !== ''
                ? `${t('tool.nature')}: ${target.natureName}`
                : '',
            ]
              .filter((part) => part !== '')
              .join(' · ');
        const fields = blacklist
          ? []
          : [
              { label: t('tool.mainLicence'), value: cellValue(target.mainLicence) },
              { label: t('tool.serviceLicence'), value: cellValue(target.serviceLicence) },
              { label: t('tool.recordTime'), value: cellValue(target.updateRecordTime) },
            ];
        items.push([detailHeading(cellValue(head)), state === '' ? null : detailSubtitle(state), fieldList(fields)]);
      }
      if (rows.length === 0) items.push([detailDescription(t('tool.noRecords'))]);
      if (model.rowsTruncated === true) items.push([detailDescription(t('tool.rowsTruncated'))]);
      return [detailsCard(items)];
    }

    /** Body of one settled `icp_query_types` call: catalog plus effective config. */
    function typesBody(t, model) {
      const types = Array.isArray(model.types) ? model.types : [];
      const config = model.config !== null && typeof model.config === 'object' ? model.config : {};
      const items = [
        [
          fieldList([
            { label: t('tool.endpoint'), value: cellValue(model.endpoint), mono: true },
            {
              label: t('tool.config'),
              value: [
                `${t('tool.configCaptcha')}: ${cellValue(config.captcha_max_attempts)}`,
                `${t('tool.configTimeout')}: ${cellValue(config.timeout_ms)} ms`,
                `${t('tool.configPageSize')}: ${cellValue(config.max_page_size)}`,
                `${t('tool.configDetailConc')}: ${cellValue(config.detail_concurrency)}`,
                `${t('tool.configDetails')}: ${config.include_details === true ? t('tool.on') : t('tool.off')}`,
              ].join(' · '),
            },
          ]),
          typeof model.note === 'string' && model.note !== '' ? detailDescription(model.note) : null,
        ],
      ];
      for (const entry of types) {
        const item = entry !== null && typeof entry === 'object' ? entry : {};
        items.push([
          detailHeading(`${cellValue(item.type)} · ${cellValue(item.label)}`),
          detailSubtitle(
            `${item.paginated === true ? t('tool.paged') : t('tool.blacklist')} · ${t('tool.searchHint', {
              hint: cellValue(item.search_hint),
            })}`,
          ),
        ]);
      }
      return [detailsCard(items)];
    }

    /** Body of one running call: the request as far as it has arrived. */
    function pendingBody(t, toolName, args) {
      const request = args !== null && typeof args === 'object' ? args : {};
      if (toolName === 'icp_query') {
        const fields = [
          { label: t('tool.type'), value: cellValue(request.type) },
          { label: t('tool.keyword'), value: cellValue(request.search), mono: true },
        ];
        if (typeof request.page_num !== 'undefined' || typeof request.page_size !== 'undefined') {
          fields.push({
            label: t('tool.paging'),
            value: [request.page_num, request.page_size].filter((part) => part !== undefined).join(' / '),
          });
        }
        return [detailsCard([[fieldList(fields)]])];
      }
      return [detailsCard([[detailDescription(t('tool.running'))]])];
    }

    /* -------------------------------------------------------------- */
    /* The card component                                             */
    /* -------------------------------------------------------------- */

    /**
     * One ICP tool call rendered like a shipped Tool card: a disclosure head
     * (glyph, title, separator, summary, stat suffix) and an expandable body.
     */
    function IcpToolRow(props) {
      const bound = props === null || props === undefined ? undefined : props.t;
      const t = React.useMemo(() => makeTranslator(bound), [bound]);
      const block = props === null || props === undefined ? undefined : props.block;
      const phase = props === null || props === undefined ? undefined : props.phase;
      const toolName = props === null || props === undefined || typeof props.toolName !== 'string' ? '' : props.toolName;
      const preparing = phase === 'preparing';
      const pending = phase !== 'result';
      const interrupted = !pending && block !== null && block !== undefined && block.error?.code === 'interrupted';
      const failed = !pending && block !== null && block !== undefined && block.isError === true && !interrupted;
      const args = React.useMemo(() => blockArgs(block), [block]);
      const meta = React.useMemo(() => (pending || failed || interrupted ? null : blockMeta(block)), [block, pending, failed, interrupted]);
      const model = meta !== null && (meta.kind === 'icp' || meta.kind === 'icp-types') ? meta : null;
      const spilled = !pending && !failed && model !== null && contentSpilled(block);
      // Results written before 1.1.0 carry head facts only (no `rows` array):
      // their body must fall back to the settled text, not claim "no records".
      const legacy = !pending && !failed && !interrupted && model !== null && toolName === 'icp_query' && !Array.isArray(model.rows);

      const head = React.useMemo(() => {
        if (pending) {
          const hint = argsSummary(t, toolName, args);
          return { summary: hint === '' ? t(preparing ? 'tool.preparing' : 'tool.running') : hint, suffix: '' };
        }
        if (interrupted) {
          const hint = argsSummary(t, toolName, args);
          return { summary: hint === '' ? t('tool.stopped') : hint, suffix: '' };
        }
        if (failed) return { summary: clip(blockError(block), 120), suffix: '' };
        if (model === null) return { summary: clip(blockText(block), 140), suffix: '' };
        return toolName === 'icp_query' ? queryHead(t, model) : typesHead(t, model);
      }, [pending, preparing, interrupted, failed, args, model, t, toolName, block]);

      // One stable disclosure Hook per mounted call: the conversation owner's
      // Hook when it supplies one, local state otherwise.
      const disclosureHook = React.useRef(null);
      if (disclosureHook.current === null) {
        const ownerHook =
          props !== null && props !== undefined && typeof props.useDisclosure === 'function' ? props.useDisclosure : null;
        disclosureHook.current =
          ownerHook === null
            ? function useLocalDisclosure() {
                const [expanded, setExpanded] = React.useState(false);
                return { expanded, toggle: () => setExpanded((current) => !current) };
              }
            : ownerHook;
      }
      const disclosure = disclosureHook.current();
      const expandable = !preparing;
      const expanded = expandable && disclosure.expanded === true;
      const toggle = () => {
        if (typeof disclosure.toggle === 'function') disclosure.toggle();
      };
      const onRowKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      };
      const state = pending ? (preparing ? 'preparing' : 'running') : interrupted ? 'stopped' : failed ? 'error' : 'ok';
      const statusText = pending
        ? t(preparing ? 'tool.preparing' : 'tool.running')
        : interrupted
          ? t('tool.stopped')
          : failed
            ? t('tool.failed')
            : null;
      const title = toolTitle(t, toolName);
      const summaryClass = interrupted
        ? 'ict_headSummary ict_stoppedSummary'
        : failed
          ? 'ict_headSummary ict_errorSummary'
          : 'ict_headSummary';
      const renderHead = (masked) => {
        const nodes = [headText(masked, 'ict_headTitle', title, 'title')];
        if (head.summary !== '') {
          nodes.push(h('span', { key: 'sep', className: 'ict_sep', 'data-shimmer-decoration': '', 'aria-hidden': true }));
          nodes.push(headText(masked, summaryClass, head.summary, 'summary'));
        }
        if (head.suffix !== '') nodes.push(headText(masked, 'ict_headSuffix', head.suffix, 'suffix'));
        return nodes;
      };

      let bodyNodes = [];
      if (expanded) {
        if (interrupted) bodyNodes = [cardNote(t('tool.stoppedNote'), 'warn')];
        else if (failed) bodyNodes = [ioCard(t('tool.errorOutput'), clip(blockError(block), 1600), true)];
        else if (pending) bodyNodes = pendingBody(t, toolName, args);
        else if (legacy) {
          // Results written before 1.1.0 carry only the old head facts, so the
          // body falls back to the settled text instead of claiming "no records".
          bodyNodes = [ioCard(t('tool.output'), clip(blockText(block), 1600), false)];
        } else if (model !== null) {
          bodyNodes = toolName === 'icp_query' ? queryBody(t, model) : typesBody(t, model);
          if (spilled) bodyNodes.push(cardNote(t('tool.spilled'), 'warn'));
        } else bodyNodes = [ioCard(t('tool.output'), clip(blockText(block), 1600), false)];
      }

      return h(
        'div',
        { className: 'ict_root', 'data-tool': toolName, 'data-state': state },
        statusText === null ? null : h('span', { className: 'ict_visuallyHidden' }, statusText),
        h(
          'div',
          { className: 'ict_disclosure', 'data-open': expanded ? '' : undefined },
          h(
            'div',
            { className: 'ict_headRow', 'data-disclosure-header': '' },
            h(
              'div',
              {
                className: 'ict_row',
                'data-disclosure-row': '',
                'data-expandable': expandable ? '' : undefined,
                role: expandable ? 'button' : undefined,
                tabIndex: expandable ? 0 : undefined,
                'aria-expanded': expandable ? expanded : undefined,
                onClick: expandable ? toggle : undefined,
                onKeyDown: expandable ? onRowKeyDown : undefined,
              },
              h(
                'span',
                { className: 'ict_leading' },
                expandable && !expanded
                  ? [
                      h('span', { key: 'glyph', className: 'ict_iconIdle' }, toolIcon(toolName)),
                      chevronIcon(false, 'ict_chevronHover', 'chevron'),
                    ]
                  : expanded
                    ? chevronIcon(true)
                    : toolIcon(toolName),
              ),
              shimmerLine({ active: pending, render: renderHead }),
            ),
          ),
          expanded
            ? h('div', { className: 'ict_bodyWrap' }, ...bodyNodes.filter((node) => node !== null && node !== undefined))
            : null,
        ),
      );
    }

    /* -------------------------------------------------------------- */
    /* Stylesheet                                                     */
    /* -------------------------------------------------------------- */

    const CSS = `
.ict_root{display:flex;flex-direction:column}
.ict_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}
.ict_disclosure{display:flex;flex-direction:column;width:100%;min-width:0}
.ict_headRow{display:flex;align-items:center;min-width:0}
.ict_row{flex:1 1 auto;position:relative;overflow:hidden;display:flex;align-items:center;height:calc(24px + var(--dsh-content-font-delta,0px));min-width:0;color:var(--dsw-alias-label-tertiary);transition:color .1s ease}
.ict_row[data-expandable]{cursor:pointer}
.ict_row:hover{color:var(--dsw-alias-label-secondary)}
.ict_leading{position:relative;flex:none;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));display:inline-flex;align-items:center;justify-content:center;margin-right:6px;padding:0;border:none;background:none;color:inherit}
.ict_leading svg:not([data-state]){width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
.ict_iconIdle{display:inline-flex;opacity:1;transition:opacity .1s ease}
.ict_chevronHover{position:absolute;inset:0;margin:auto;opacity:0;transition:opacity .1s ease}
.ict_row:hover .ict_iconIdle{opacity:0}
.ict_row:hover .ict_chevronHover{opacity:1}
.ict_headTitle{flex:none;font-weight:400;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:inherit}
.ict_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;display:block;width:2px;height:2px;margin:0 8px}
.ict_headSummary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));flex:auto;overflow:hidden}
.ict_headSuffix{white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));flex:none;margin-left:4px}
.ict_errorSummary{color:var(--dsw-alias-state-error-primary)}.ict_stoppedSummary{color:var(--dsw-alias-state-warn-label)}
.ict_shimmer{position:relative;display:inline-grid;width:max-content;max-width:100%;min-width:0;vertical-align:top;color:inherit}
.ict_shimmerContent{display:flex;align-items:center;min-width:0}
.ict_shimmerText{color:inherit}
.ict_shimmerText[data-shimmer-text]:after{content:attr(data-shimmer-text)}
.ict_shimmerDecoration{position:absolute;inset:0;overflow:clip;pointer-events:none;user-select:none}
.ict_shimmerSweep{position:absolute;inset:0;overflow:hidden;color:var(--dsw-alias-label-shimmer);mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);transform:translate(-100%);animation:ict-sweep 1.5s steps(48,end) .3s infinite}
.ict_shimmerSweep *{color:inherit!important}
.ict_shimmerSweep [data-shimmer-decoration]{background:currentColor}
.ict_shimmerHighlight{width:100%;height:100%;transform:translate(100%);animation:ict-highlight 1.5s steps(48,end) .3s infinite}
@keyframes ict-sweep{0%{transform:translate(-100%)}66.6667%,to{transform:translate(100%)}}
@keyframes ict-highlight{0%{transform:translate(100%)}66.6667%,to{transform:translate(-100%)}}
@media(prefers-reduced-motion:reduce){.ict_row{transition:none}.ict_shimmerDecoration{display:none}.ict_shimmerSweep,.ict_shimmerHighlight{animation:none}}
.ict_bodyWrap{flex-direction:column;display:flex}
.ict_detailsCard{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);margin:4px 0 4px 4px;overflow:hidden}
.ict_detailsList{max-height:320px;margin:0;padding:0;list-style:none;overflow-y:auto}
.ict_detailsItem{margin:0;padding:10px 14px}
.ict_detailsItem+.ict_detailsItem{border-top:.5px solid var(--dsw-alias-border-l2)}
.ict_detailsHeading{flex-wrap:wrap;align-items:baseline;gap:8px;display:flex}
.ict_detailsText{white-space:pre-wrap;overflow-wrap:anywhere;flex:1;min-width:0}
.ict_detailsFields{margin:0}
.ict_detailsHeading+.ict_detailsFields{margin-top:6px}
.ict_detailsField{grid-template-columns:5.5em minmax(0,1fr);gap:12px;display:grid}
.ict_detailsField+.ict_detailsField{margin-top:4px}
.ict_detailsField dt{color:var(--dsw-alias-label-caption)}
.ict_detailsField dd{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.ict_detailsSubtitle{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin-top:3px;font-size:12px}
.ict_detailsDescription{color:var(--dsw-alias-label-caption);white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
.ict_ioCard{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);flex-direction:column;margin:4px 0 4px 4px;display:flex}
.ict_ioSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}
.ict_ioLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}
.ict_ioText{white-space:pre-wrap;word-break:break-word;min-width:0;color:var(--dsw-alias-label-secondary)}
.ict_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}
.ict_mono{font-family:var(--ds-font-family-code)}
.ict_note{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:4px 0 4px 4px}
.ict_note[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
`;

    /** Register the conversation cards, their dictionary and stylesheet. */
    function apply(ctx) {
      if (typeof ctx.locale?.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { en: DICT.en, zh: DICT.zh }), 'dsh-icp: dictionaries');
      }
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-icp-query';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'dsh-icp: stylesheet');
      // One keyed conversation card per wire tool name.
      for (const toolName of ['icp_query', 'icp_query_types']) {
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register({ name: 'tool.call.toolview', key: toolName, locale: NS }, IcpToolRow),
        );
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
