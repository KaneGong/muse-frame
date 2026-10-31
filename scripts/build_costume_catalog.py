#!/usr/bin/env python3
"""更新服装库的公开目录元数据，不批量下载或分发图片。

用法：python3 scripts/build_costume_catalog.py [--from-html PATH] [--out PATH]
图片预览从来源站按需显示；用户逐张选择原图并导入工作台。
"""
import argparse, json, re, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / 'app' / 'static'
SOURCE = 'https://ai-costume-gallery.pages.dev/'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh) AI-Portrait-Studio-catalog/1.0'}

CATEGORIES = [
    ('SPR', '春', '春装', 'general'),
    ('SUM', '夏', '夏装', 'general'),
    ('AUT', '秋', '秋装', 'general'),
    ('WIN', '冬', '冬装', 'general'),
    ('LNG', 'ランジェリー', '内衣', 'restricted'),
    ('PTY', 'パーティ', '派对', 'general'),
    ('SWM', '水着', '泳装', 'restricted'),
    ('SXY', 'セクシー', '性感', 'restricted'),
]

# 86 个受控词（站点关键词词表）→ 中文。只影响检索与卡片标签，不改变原英文关键词。
KEYWORDS = {
    'apron': '围裙', 'bag': '包', 'beanie': '毛线帽', 'beige': '米色', 'belt': '腰带',
    'beret': '贝雷帽', 'black': '黑色', 'blouse': '女衫', 'blue': '蓝色', 'boots': '靴子',
    'bra': '文胸', 'briefs': '内裤', 'brown': '棕色', 'burgundy': '酒红', 'camisole': '吊带衫',
    'cardigan': '开衫', 'chiffon': '雪纺', 'choker': '颈链', 'coat': '大衣', 'corduroy': '灯芯绒',
    'corset': '束腰', 'cream': '奶油色', 'denim': '牛仔', 'dress': '连衣裙', 'floral': '碎花',
    'frill': '荷叶边', 'fur': '毛皮', 'gloves': '手套', 'gold': '金色', 'green': '绿色',
    'grey': '灰色', 'hat': '帽子', 'headband': '发箍', 'heels': '高跟鞋', 'hoodie': '卫衣',
    'ivory': '象牙白', 'jacket': '夹克', 'jeans': '牛仔裤', 'khaki': '卡其', 'knit': '针织',
    'lace': '蕾丝', 'lavender': '薰衣草色', 'leather': '皮革', 'loafers': '乐福鞋', 'maxi': '长款',
    'mesh': '网纱', 'midi': '及膝', 'mini': '短款', 'mint': '薄荷绿', 'muffler': '围脖',
    'necklace': '项链', 'navy': '藏青', 'olive': '橄榄绿', 'orange': '橙色', 'pants': '长裤',
    'pink': '粉色', 'pleated': '百褶', 'polka-dot': '波点', 'pumps': '浅口鞋', 'purple': '紫色',
    'red': '红色', 'ribbon': '缎带', 'robe': '长袍', 'sandals': '凉鞋', 'satin': '缎面',
    'scarf': '围巾', 'shirt': '衬衫', 'shorts': '短裤', 'silver': '银色', 'skirt': '半身裙',
    'sneakers': '运动鞋', 'socks': '短袜', 'stockings': '长袜', 'suede': '麂皮', 'sunglasses': '墨镜',
    'sweater': '毛衣', 'swimsuit': '泳装', 'tights': '连裤袜', 'tote': '托特包', 'tulle': '薄纱',
    'turtleneck': '高领衫', 'velvet': '天鹅绒', 'vest': '马甲', 'white': '白色', 'wool': '羊毛',
    'yellow': '黄色',
}

ITEM = re.compile(r'\{"id": "([A-Z]{3}-\d{4})", "カテゴリ": "([^"]+)", "キーワード": "([^"]*)"'
                  r', "サムネ": "([^"]+)", "画像": "([^"]+)", "原寸": "([^"]+)"\}')


def fetch(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def html_source(path):
    if path:
        return Path(path).read_text(encoding='utf-8')
    return fetch(SOURCE).decode('utf-8')


def parse(html):
    items = []
    for cid, cat, kw, thumb, image, full in ITEM.findall(html):
        tokens = kw.split()
        unknown = [t for t in tokens if t not in KEYWORDS]
        if unknown:
            print(f'  ! {cid} 含未登记关键词 {unknown}', file=sys.stderr)
        items.append({
            'id': cid,
            'cat': cat,
            'kw': kw,
            'zh': '·'.join(KEYWORDS.get(t, t) for t in tokens),
            'thumb': thumb,
            'image': image,
            'full': full,
        })
    return items


def build(items):
    counts = {}
    for it in items:
        counts[it['cat']] = counts.get(it['cat'], 0) + 1
    cats = [{'code': code, 'name': name, 'label': label, 'tier': tier, 'count': counts.get(name, 0)}
            for code, name, label, tier in CATEGORIES]
    return {
        'version': 'COSTUME-DB-01',
        'source': SOURCE,
        'author': 'ギア (@giaaibusi)',
        'built_at': time.strftime('%Y-%m-%d'),
        'count': len(items),
        'base': SOURCE,
        'note': '服装参考图库：无人物、2:3、原寸 1366×2048 PNG。原寸仅在选用时按需下载。',
        'categories': cats,
        'keywords': KEYWORDS,
        'items': items,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from-html', help='用本地已保存的页面代替联网抓取')
    ap.add_argument('--out', default=str(STATIC / 'costumes.json'))
    args = ap.parse_args()

    html = html_source(args.from_html)
    items = parse(html)
    if not items:
        sys.exit('没有解析到任何服装条目，页面结构可能已变化')
    catalog = build(items)
    Path(args.out).write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size = Path(args.out).stat().st_size
    print(f'已写入 {args.out}（{catalog["count"]} 套，{size / 1024:.1f} KB）')
    for c in catalog['categories']:
        print(f'  {c["label"]:<4} {c["code"]}  {c["count"]:>4}  ({c["tier"]})')


if __name__ == '__main__':
    main()
