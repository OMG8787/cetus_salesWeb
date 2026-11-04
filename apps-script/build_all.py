"""把 Code.gs + Bot.gs + BotStaff.gs + Copy.gs 合併成單一檔案 AllInOne.gs（一次貼上、一次部署）。

用法（在專案根目錄或任何地方）：  python apps-script/build_all.py
改完任何一個 .gs 之後重新執行一次，再把產生的 AllInOne.gs 整份貼進 Apps Script 的 Code.gs（取代全部內容）。
Apps Script 專案裡所有 .gs 檔案共用同一個全域範圍，所以串在一起跟分開貼是一樣的；合併後專案裡只要留一個檔案。
ImportData.gs（含客戶個資、不進 GitHub）不在合併範圍內，需要匯入舊資料時才另外貼。
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARTS = ['Code.gs', 'Bot.gs', 'BotStaff.gs', 'Copy.gs']
OUT = 'AllInOne.gs'

parts = []
for name in PARTS:
    text = open(os.path.join(HERE, name), encoding='utf8', newline='').read().replace('\r\n', '\n').strip('\n')
    parts.append((name, text))

# 同名的頂層函式 / var 會互相覆蓋，合併前先擋下來
seen = {}
dups = []
for name, text in parts:
    for m in re.finditer(r'^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)\s*=)', text, re.M):
        ident = m.group(1) or m.group(2)
        if ident in seen and seen[ident] != name:
            dups.append('%s（%s 與 %s）' % (ident, seen[ident], name))
        seen.setdefault(ident, name)
if dups:
    print('有重複定義，請先處理：')
    print('\n'.join(dups))
    sys.exit(1)

banner = '''/**
 * ============================================================
 * AllInOne.gs - 由 build_all.py 自動合併（請不要直接改這個檔案，改原本的 .gs 後重新執行 python apps-script/build_all.py）
 * 內容依序是：Code.gs（核心）→ Bot.gs（客服機器人）→ BotStaff.gs（員工助理）→ Copy.gs（文案製作）
 * ============================================================
 */
'''
out = [banner]
for name, text in parts:
    out.append('// ' + '=' * 60 + '\n// ===== 以下來自 %s =====\n// ' % name + '=' * 60 + '\n' + text + '\n')

content = '\n'.join(out)
open(os.path.join(HERE, OUT), 'w', encoding='utf8', newline='').write(content)
print('已產生 %s：%d 行、%d 個頂層名稱，沒有重複定義' % (OUT, content.count('\n') + 1, len(seen)))
