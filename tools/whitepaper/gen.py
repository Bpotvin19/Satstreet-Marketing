#!/usr/bin/env python3
"""Generate public/whitepaper.html from the text of bitcoin.org's bitcoin.pdf.

Prose is taken line-for-line from `pdftotext bitcoin.pdf raw.txt`, so the
wording is the PDF's own; only extraction artefacts are repaired (words the
extractor fused at a line-end hyphen). Figures are redrawn as SVG and the
formulas set in MathML.

Usage, from the repository root:

    pdftotext public/assets/bitcoin.pdf /tmp/raw.txt
    python3 tools/whitepaper/gen.py /tmp/raw.txt public/whitepaper.html tools/whitepaper/template.html
    python3 tools/build-webflow.py

The line numbers below refer to that pdftotext output (poppler's default
mode); the asserts near the end fail loudly if the extraction ever differs.
Page styling lives in template.html; edit there, not in the generated page."""
import html, re, sys, pathlib

RAW = pathlib.Path(sys.argv[1]).read_text().split('\n')
OUT = pathlib.Path(sys.argv[2])

FIX = [('proofof-work', 'proof-of-work'), ('nonreversible', 'non-reversible')]


def lines(a, b):
    """Raw lines a..b (1-indexed, inclusive) joined into one string."""
    t = ' '.join(l.strip() for l in RAW[a - 1:b] if l.strip() and not l.strip().isdigit())  # bare digits are page numbers
    for x, y in FIX:
        t = t.replace(x, y)
    return re.sub(r'\s+', ' ', t).strip()


def refs(t):
    t = html.escape(t, quote=False)
    def one(m):
        inner = m.group(1)
        first = re.match(r'\d+', inner).group(0)
        return f'<a class="cite" href="#ref-{first}">[{inner}]</a>'
    return re.sub(r'\[(\d+(?:-\d+)?)\]', one, t)


def paras(a, b, starts=(), fmt=None):
    t = lines(a, b)
    cuts = [0] + [t.index(s) for s in starts] + [len(t)]
    out = []
    for i in range(len(cuts) - 1):
        p = refs(t[cuts[i]:cuts[i + 1]].strip())
        if fmt:
            p = fmt(p)
        out.append(f'<p>{p}</p>')
    return '\n'.join(out)


def var(p):
    """Italicise the paper's variables where the PDF sets them in italic."""
    p = p.replace('p &gt; q', '<i>p</i> &gt; <i>q</i>')
    p = p.replace(' and z blocks', ' and <i>z</i> blocks')
    p = p.replace('exponentially with z.', 'exponentially with <i>z</i>.')
    return p


# ── SVG drawing helpers ───────────────────────────────────────────────────
def box(x, y, w, h, label='', cls='b', fs=11.5):
    s = f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="4"/>'
    if label:
        parts = label.split('\n')
        lh = fs + 2
        y0 = y + h / 2 - (len(parts) - 1) * lh / 2
        for i, p in enumerate(parts):
            s += f'<text class="c" x="{x + w / 2:g}" y="{y0 + i * lh:g}">{html.escape(p)}</text>'
    return s


def frame(x, y, w, h, title):
    return (f'<rect class="f" x="{x}" y="{y}" width="{w}" height="{h}" rx="7"/>'
            f'<text class="ft" x="{x + 10}" y="{y + 16}">{html.escape(title)}</text>')


def arrow(*pts, cls='a'):
    d = 'M' + ' L'.join(f'{x:g} {y:g}' for x, y in pts)
    return f'<path class="{cls} m" d="{d}"/>'


def line(*pts, cls='a'):
    d = 'M' + ' L'.join(f'{x:g} {y:g}' for x, y in pts)
    return f'<path class="{cls}" d="{d}"/>'


def label(x, y, t, cls='lb', anchor='start', rot=None):
    r = f' transform="rotate({rot} {x} {y})"' if rot is not None else ''
    return f'<text class="{cls}" x="{x}" y="{y}" text-anchor="{anchor}"{r}>{html.escape(t)}</text>'


def svg(w, h, body, title):
    return (f'<div class="wp-fig-scroll"><svg class="wp-svg" viewBox="0 0 {w} {h}" '
            f'style="min-width:{min(w, 560)}px;max-width:{w}px" role="img" aria-label="{html.escape(title)}">{body}</svg></div>')


def figure(n, title, s):
    return f'<figure class="wp-fig" id="fig-{n}">{s}<figcaption><span>Figure {n}</span> {html.escape(title)}</figcaption></figure>'


# Figure 1 — Transactions
def fig_tx():
    s = ''
    xs = [60, 250, 440]
    for i, x in enumerate(xs):
        s += frame(x, 10, 140, 200, 'Transaction')
        s += box(x + 20, 32, 100, 38, f"Owner {i + 1}'s\nPublic Key")
        s += box(x + 40, 104, 60, 24, 'Hash', 'b em')
        s += box(x + 20, 158, 100, 38, f"Owner {i}'s\nSignature", 'b sig')
        s += box(x + 20, 248, 100, 38, f"Owner {i + 1}'s\nPrivate Key", 'b key')
        s += arrow((x + 84, 70), (x + 84, 103))
        s += arrow((x + 70, 128), (x + 70, 157))
        src = 12 if i == 0 else xs[i - 1] + 140
        s += arrow((src, 86), (x + 56, 86), (x + 56, 103))
        if i < 2:
            nx = xs[i + 1]
            s += arrow((x + 121, 51), (x + 130, 51), (x + 130, 120), (nx + 19, 170), cls='a dash')
            s += label((x + 130 + nx + 19) / 2 + 4, 138, 'Verify', 'lb it', 'middle', 27)
            s += arrow((x + 120, 262), (nx + 19, 188), cls='a dash')
            s += label((x + 120 + nx + 19) / 2 + 2, 220, 'Sign', 'lb it', 'middle', -32)
    return svg(600, 296, s, 'Three transactions, each signing the hash of the previous transaction and the next owner’s public key')


# Figure 2 — Timestamp server
def fig_ts():
    s = ''
    for i, x in enumerate([90, 330]):
        s += frame(x, 64, 170, 66, 'Block')
        s += box(x + 14, 96, 44, 22, 'Item', 'b sm', 10.5)
        s += box(x + 64, 96, 44, 22, 'Item', 'b sm', 10.5)
        s += box(x + 114, 96, 40, 22, '…', 'b sm', 10.5)
        s += box(x + 55, 10, 60, 26, 'Hash', 'b em')
        s += arrow((x + 85, 63), (x + 85, 37))
    s += arrow((20, 23), (144, 23)) + arrow((206, 23), (384, 23)) + arrow((446, 23), (580, 23))
    return svg(600, 140, s, 'Timestamp server: each hash covers a block of items and the previous hash')


# Figure 3 — Proof-of-work
def fig_pow():
    s = ''
    for x in [80, 340]:
        s += frame(x, 10, 200, 96, 'Block')
        s += box(x + 14, 32, 100, 24, 'Prev Hash', 'b em')
        s += box(x + 122, 32, 64, 24, 'Nonce', 'b nonce')
        s += box(x + 14, 68, 50, 24, 'Tx', 'b sm', 10.5)
        s += box(x + 72, 68, 50, 24, 'Tx', 'b sm', 10.5)
        s += box(x + 130, 68, 56, 24, '…', 'b sm', 10.5)
    s += arrow((20, 44), (93, 44)) + arrow((280, 44), (353, 44))
    return svg(600, 116, s, 'Blocks chained by previous hash, each holding a nonce and transactions')


# Figure 4 — Merkle tree and pruning
def merkle(ox, pruned):
    s = frame(ox + 10, 10, 300, 252, 'Block')
    s += f'<rect class="f2" x="{ox + 64}" y="22" width="232" height="88" rx="6"/>'
    s += label(ox + 74, 38, 'Block Header (Block Hash)', 'ft')
    s += box(ox + 78, 48, 100, 22, 'Prev Hash', 'b em')
    s += box(ox + 188, 48, 90, 22, 'Nonce', 'b nonce')
    s += box(ox + 130, 80, 100, 22, 'Root Hash', 'b em')
    leaves = [(ox + 22, 'Hash0', 'Tx0'), (ox + 90, 'Hash1', 'Tx1'), (ox + 158, 'Hash2', 'Tx2'), (ox + 226, 'Hash3', 'Tx3')]
    mids = [(ox + 64, 'Hash01'), (ox + 196, 'Hash23')]
    for i, (x, n) in enumerate(mids):
        keep_solid = pruned and n == 'Hash01'
        s += box(x, 142, 70, 22, n, 'b' if keep_solid else 'b dashed')
        s += arrow((x + 35, 141), (ox + 180 + (i * 2 - 1) * 20, 103))
    for i, (x, h, t) in enumerate(leaves):
        if pruned and i < 2:
            continue
        solid = pruned and h == 'Hash2'
        s += box(x, 192, 62, 22, h, 'b' if solid else 'b dashed')
        mx = mids[i // 2][0] + 35 + (i % 2 * 2 - 1) * 12
        s += arrow((x + 31, 191), (mx, 165))
        if pruned and i < 3:
            continue
        s += box(x + 9, 234, 44, 20, t, 'b sm', 10.5)
        s += arrow((x + 31, 233), (x + 31, 215))
    s += label(ox + 160, 282, 'After Pruning Tx0-2 from the Block' if pruned else 'Transactions Hashed in a Merkle Tree', 'cap', 'middle')
    return s


def fig_merkle():
    return svg(640, 292, merkle(0, False) + merkle(320, True), 'A block’s transactions hashed into a Merkle tree, and the same block after pruning Tx0 to Tx2')


# Figure 5 — Simplified payment verification
def fig_spv():
    s = label(24, 16, 'Longest Proof-of-Work Chain', 'ft')
    for x in [30, 240, 450]:
        s += frame(x, 24, 170, 86, 'Block Header')
        s += box(x + 12, 46, 88, 22, 'Prev Hash', 'b em')
        s += box(x + 106, 46, 52, 22, 'Nonce', 'b nonce')
        s += box(x + 34, 78, 96, 22, 'Merkle Root', 'b em')
    s += arrow((4, 57), (41, 57)) + arrow((200, 57), (251, 57)) + arrow((410, 57), (461, 57)) + arrow((620, 57), (638, 57))
    s += box(236, 150, 66, 22, 'Hash01')
    s += box(332, 150, 66, 22, 'Hash23', 'b dashed')
    s += box(298, 206, 58, 22, 'Hash2')
    s += box(368, 206, 58, 22, 'Hash3', 'b dashed')
    s += box(377, 258, 40, 20, 'Tx3', 'b sm', 10.5)
    s += arrow((397, 257), (397, 229)) + arrow((327, 205), (355, 173)) + arrow((397, 205), (375, 173))
    s += arrow((269, 149), (310, 101)) + arrow((365, 149), (330, 101))
    s += label(440, 190, 'Merkle Branch for Tx3', 'lb')
    return svg(640, 288, s, 'Block headers of the longest chain, with the Merkle branch linking Tx3 to its block')


# Figure 6 — Combining and splitting value
def fig_io():
    s = frame(150, 10, 130, 122, 'Transaction')
    for i, t in enumerate(['In', 'In', '…']):
        s += box(168, 32 + i * 32, 40, 22, t, 'b em' if t == 'In' else 'b sm', 10.5)
        s += arrow((70, 43 + i * 32), (167, 43 + i * 32))
    for i, t in enumerate(['Out', '…']):
        s += box(222, 32 + i * 32, 40, 22, t, 'b nonce' if t == 'Out' else 'b sm', 10.5)
        s += arrow((263, 43 + i * 32), (360, 43 + i * 32))
    return svg(430, 142, s, 'A transaction with several inputs and up to two outputs')


# Figure 7 — Privacy
def fig_privacy():
    s = label(20, 18, 'Traditional Privacy Model', 'ft')
    s += box(20, 32, 96, 34, 'Identities')
    s += box(134, 32, 96, 34, 'Transactions')
    s += box(248, 28, 96, 42, 'Trusted\nThird Party', 'b em')
    s += box(362, 32, 96, 34, 'Counterparty')
    s += line((116, 49), (134, 49)) + arrow((230, 49), (247, 49)) + arrow((344, 49), (361, 49))
    s += '<path class="wall" d="M478 22 V76"/>'
    s += box(498, 28, 96, 42, 'Public', 'b pub')
    s += label(20, 112, 'New Privacy Model', 'ft')
    s += box(20, 126, 96, 34, 'Identities')
    s += '<path class="wall" d="M134 116 V170"/>'
    s += box(152, 126, 96, 34, 'Transactions')
    s += arrow((248, 143), (265, 143))
    s += box(266, 122, 96, 42, 'Public', 'b pub')
    return svg(614, 178, s, 'Traditional privacy model compared with the new privacy model')


# ── Formulas (MathML) ─────────────────────────────────────────────────────
QP = '<mrow><mo>(</mo><mi>q</mi><mo lspace="0" rspace="0">/</mo><mi>p</mi><mo>)</mo></mrow>'
ZK = '<mrow><mo>(</mo><mi>z</mi><mo>−</mo><mi>k</mi><mo>)</mo></mrow>'
POIS = '<mfrac><mrow><msup><mi>λ</mi><mi>k</mi></msup><msup><mi>e</mi><mrow><mo>−</mo><mi>λ</mi></mrow></msup></mrow><mrow><mi>k</mi><mo>!</mo></mrow></mfrac>'


def cases(rows):
    trs = ''.join(f'<mtr><mtd>{a}</mtd><mtd><mtext>if </mtext>{b}</mtd></mtr>' for a, b in rows)
    return f'<mrow><mo>{{</mo><mtable class="cases">{trs}</mtable><mo>}}</mo></mrow>'


EQ1 = ('<math display="block"><msub><mi>q</mi><mi>z</mi></msub><mo>=</mo>' +
       cases([('<mn>1</mn>', '<mi>p</mi><mo>≤</mo><mi>q</mi>'),
              (f'<msup>{QP}<mi>z</mi></msup>', '<mi>p</mi><mo>&gt;</mo><mi>q</mi>')]) + '</math>')
EQ2 = '<math display="block"><mi>λ</mi><mo>=</mo><mi>z</mi><mfrac><mi>q</mi><mi>p</mi></mfrac></math>'
EQ3 = ('<math display="block"><munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>0</mn></mrow><mi>∞</mi></munderover>' +
       POIS + '<mo>⋅</mo>' +
       cases([(f'<msup>{QP}{ZK}</msup>', '<mi>k</mi><mo>≤</mo><mi>z</mi>'),
              ('<mn>1</mn>', '<mi>k</mi><mo>&gt;</mo><mi>z</mi>')]) + '</math>')
EQ4 = ('<math display="block"><mn>1</mn><mo>−</mo><munderover><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>0</mn></mrow><mi>z</mi></munderover>' +
       POIS + f'<mrow><mo>(</mo><mn>1</mn><mo>−</mo><msup>{QP}{ZK}</msup><mo>)</mo></mrow></math>')


def code():
    """The C listing, re-indented by brace depth (the PDF's indentation does
    not survive text extraction)."""
    out, depth, extra = [], 0, False
    for raw in RAW[511:527]:
        l = raw.strip()
        if not l:
            continue
        if l == '}':
            depth -= 1
        pad = depth + (1 if extra else 0)
        out.append('    ' * pad + l)
        extra = False
        if l == '{':
            depth += 1
        elif l.startswith('for (i'):
            extra = True  # single-statement loop body
    return '<pre class="wp-code"><code>' + html.escape('\n'.join(out)) + '</code></pre>'


def table(caption, head, rows):
    th = ''.join(f'<th scope="col">{h}</th>' for h in head)
    tr = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table class="wp-table"><caption>{caption}</caption><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>'


def results():
    z1 = [l.strip()[2:] for l in RAW[532:543]]
    p1 = [l.strip()[2:] for l in RAW[544:555]]
    z2 = [l.strip()[2:] for l in RAW[557:568]]
    p2 = [l.strip()[2:] for l in RAW[569:580]]
    sol = RAW[583:599]
    qs = [sol[i].strip()[2:] for i in range(0, 16, 2)]
    zs = [sol[i].strip()[2:] for i in range(1, 16, 2)]
    assert len(z1) == len(p1) == 11 and len(z2) == len(p2) == 11 and len(qs) == 8, (z1, p1, z2, p2, qs)
    return ('<div class="wp-tables">' +
            table('<i>q</i> = 0.1', ['<i>z</i>', '<i>P</i>'], zip(z1, p1)) +
            table('<i>q</i> = 0.3', ['<i>z</i>', '<i>P</i>'], zip(z2, p2)) +
            '</div>', table('<i>P</i> &lt; 0.001', ['<i>q</i>', '<i>z</i>'], zip(qs, zs)))


def references():
    items, cur = [], None
    for l in RAW[617:631]:
        l = l.strip()
        if not l:
            continue
        m = re.match(r'\[(\d+)\]\s*(.*)', l)
        if m:
            cur = [m.group(1), m.group(2)]
            items.append(cur)
        else:
            cur[1] += ' ' + l
    out = []
    for n, t in items:
        t = html.escape(t, quote=False)
        t = re.sub(r'(https?://\S+?)(,)', r'<a href="\1" target="_blank" rel="noopener noreferrer">\1</a>\2', t)
        out.append(f'<li id="ref-{n}"><span class="rn">[{n}]</span><span>{t}</span></li>')
    return '<ol class="wp-refs">' + ''.join(out) + '</ol>'


def section(n, title, body):
    sid = 's' + str(n)
    return f'<section class="wp-sec" id="{sid}" aria-labelledby="{sid}-h"><h2 id="{sid}-h"><span class="num">{n}.</span> {html.escape(title)}</h2>\n{body}\n</section>'


steps = [lines(209, 209), lines(210, 210), lines(211, 211), lines(212, 212), lines(213, 213), lines(214, 215)]
res_tables, sol_table = results()

S = [
    (1, 'Introduction', paras(25, 43, ['What is needed'])),
    (2, 'Transactions', paras(51, 54) + figure(1, 'Transactions', fig_tx()) + paras(105, 118, ['We need a way'])),
    (3, 'Timestamp Server', paras(124, 128) + figure(2, 'Timestamp server', fig_ts())),
    (4, 'Proof-of-Work', paras(153, 161, ['For our timestamp']) + figure(3, 'Proof-of-work chain', fig_pow()) +
     paras(184, 195, ['To compensate'])),
    (5, 'Network', paras(201, 201) + '<ol class="wp-steps">' + ''.join(f'<li>{html.escape(t)}</li>' for t in steps) + '</ol>' +
     paras(217, 228, ['New transaction broadcasts'])),
    (6, 'Incentive', paras(234, 248, ['The incentive can also', 'The incentive may help'])),
    (7, 'Reclaiming Disk Space', paras(254, 258) + figure(4, 'Merkle tree, before and after pruning', fig_merkle()) + paras(311, 315)),
    (8, 'Simplified Payment Verification', paras(323, 328) + figure(5, 'Simplified payment verification', fig_spv()) + paras(362, 369)),
    (9, 'Combining and Splitting Value', paras(375, 379) + figure(6, 'Inputs and outputs', fig_io()) + paras(391, 393)),
    (10, 'Privacy', paras(398, 404) + figure(7, 'Privacy models', fig_privacy()) + paras(424, 428)),
    (11, 'Calculations',
     paras(431, 444, ['The race between', 'The probability of an attacker']) +
     '<dl class="wp-defs"><div><dt><i>p</i></dt><dd>probability an honest node finds the next block</dd></div>'
     '<div><dt><i>q</i></dt><dd>probability the attacker finds the next block</dd></div>'
     '<div><dt><i>q<sub>z</sub></i></dt><dd>probability the attacker will ever catch up from <i>z</i> blocks behind</dd></div></dl>' +
     f'<div class="wp-eq">{EQ1}</div>' +
     paras(461, 477, ['We now consider', 'The receiver generates', 'The recipient waits'], var) +
     f'<div class="wp-eq">{EQ2}</div>' + paras(484, 485) + f'<div class="wp-eq">{EQ3}</div>' +
     paras(501, 501) + f'<div class="wp-eq">{EQ4}</div>' + paras(511, 511) + code() +
     paras(531, 531, fmt=var) + res_tables + paras(582, 582) + sol_table),
    (12, 'Conclusion', paras(602, 613)),
]

# Sanity: the definitions above are the PDF's lines 445-447, reworded only into markup.
assert lines(445, 445) == 'p = probability an honest node finds the next block'
assert lines(446, 446) == 'q = probability the attacker finds the next block'
assert lines(447, 447) == 'qz = probability the attacker will ever catch up from z blocks behind'
assert RAW[0] == 'Bitcoin: A Peer-to-Peer Electronic Cash System'

abstract = refs(lines(6, 19)).replace('Abstract. ', '', 1)
toc = ''.join(f'<li><a href="#s{n}"><span>{n}.</span>{html.escape(t)}</a></li>' for n, t, _ in S)
toc += '<li><a href="#refs"><span></span>References</a></li>'
sections = '\n'.join(section(n, t, b) for n, t, b in S)

DEFS = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'
        '<marker id="wp-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0 0 L10 5 L0 10 z" fill="#4a5d73"/></marker></defs></svg>')

TEMPLATE = pathlib.Path(sys.argv[3]).read_text()
page = (TEMPLATE.replace('{{ABSTRACT}}', abstract).replace('{{TOC}}', toc)
        .replace('{{SECTIONS}}', sections).replace('{{REFS}}', references()).replace('{{DEFS}}', DEFS))
OUT.write_text(page)
print(len(page), 'chars')
