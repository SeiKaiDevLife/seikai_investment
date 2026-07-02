import os
import json
import urllib.request
import pandas as pd

# 路径配置
UPLOADER_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_XLSX_PATH = os.path.join(UPLOADER_DIR, 'data.xlsx')
PROJECT_ROOT = os.path.dirname(UPLOADER_DIR)
DATA_OUT_DIR = os.path.join(PROJECT_ROOT, 'data')

def process():
    print(f"开始读取持仓数据: {DATA_XLSX_PATH}")
    if not os.path.exists(DATA_XLSX_PATH):
        print("错误：找不到 data.xlsx 文件！请确认文件存在于 _uploader 目录中。")
        return

    # 读取 Excel 文件
    try:
        # 要求表头：基金代码、持仓成本价、持有份额
        df = pd.read_excel(DATA_XLSX_PATH, dtype={'基金代码': str})
    except Exception as e:
        print(f"读取 Excel 失败 (请确保已安装 pandas 和 openpyxl): {e}")
        return

    # 清理并转换格式
    holdings = []
    for index, row in df.iterrows():
        code = str(row.get('基金代码', '')).strip().zfill(6) # 补齐6位
        cost = row.get('持仓成本价', 0.0)
        shares = row.get('持有份额', 0.0)
        
        if not code or code == '000000':
            continue
            
        holdings.append({
            "code": code,
            "cost_price": float(cost),
            "shares": float(shares)
        })

    import re

    # 下载每个基金的天天基金 JS 数据包，并解析出我们需要的数据，防止前端变量冲突
    for item in holdings:
        code = item['code']
        url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
        
        print(f"正在拉取并解析基金 {code} 的历史数据...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                content = response.read().decode('utf-8')
                
                # 提取基金名称
                name_match = re.search(r'var fS_name = "(.*?)";', content)
                item['name'] = name_match.group(1) if name_match else code
                
                # 提取历史净值走势 (用于画折线图)
                trend_match = re.search(r'var Data_netWorthTrend\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['netWorthTrend'] = json.loads(trend_match.group(1)) if trend_match else []
                
                # 提取最新十大重仓股
                stock_match = re.search(r'var stockCodesNew\s*=\s*(\[.*?\]);', content, re.DOTALL)
                if not stock_match:
                    stock_match = re.search(r'var stockCodes\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['stockCodes'] = json.loads(stock_match.group(1)) if stock_match else []

                # 提取累计收益率走势（包含沪深300和同类平均对比）
                grand_match = re.search(r'var Data_grandTotal\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['grandTotal'] = json.loads(grand_match.group(1)) if grand_match else []

                # 提取资产配置比例（股票、债券、现金）
                asset_match = re.search(r'var Data_assetAllocation\s*=\s*(\{.*?\});', content, re.DOTALL)
                item['assetAllocation'] = json.loads(asset_match.group(1)) if asset_match else {}
                
                # 提取基金经理
                mgr_match = re.search(r'var Data_currentFundManager\s*=\s*(.*?);', content, re.DOTALL)
                if mgr_match:
                    try: item['manager'] = json.loads(mgr_match.group(1))
                    except: item['manager'] = []
                else: item['manager'] = []

                # 提取收益率标签
                item['syl_1y'] = re.search(r'var syl_1y\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_1y\s*=\s*"([^"]*)";', content) else "--"
                item['syl_3y'] = re.search(r'var syl_3y\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_3y\s*=\s*"([^"]*)";', content) else "--"
                item['syl_1n'] = re.search(r'var syl_1n\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_1n\s*=\s*"([^"]*)";', content) else "--"
                
                # 提取规模
                scale_match = re.search(r'var Data_fluctuationScale\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['scale'] = json.loads(scale_match.group(1)) if scale_match else []

                print(f"[{code}] 解析成功 | 净值:{len(item['netWorthTrend'])}条 | 收益对比:{len(item['grandTotal'])}类")
        except Exception as e:
            print(f"拉取或解析基金 {code} 数据失败: {e}")
            item['name'] = code
            item['netWorthTrend'] = []
            item['stockCodes'] = []

    # 将合并了历史数据的最终结果保存到 data 目录
    holdings_path_json = os.path.join(DATA_OUT_DIR, 'holdings.json')
    with open(holdings_path_json, 'w', encoding='utf-8') as f:
        json.dump(holdings, f, ensure_ascii=False, indent=2)
        
    holdings_path_js = os.path.join(DATA_OUT_DIR, 'holdings.js')
    with open(holdings_path_js, 'w', encoding='utf-8') as f:
        js_content = "const MY_HOLDINGS = " + json.dumps(holdings, ensure_ascii=False, indent=2) + ";"
        f.write(js_content)
        
    print(f"\n全部数据处理完毕！最终数据已生成到 data 目录。")

if __name__ == "__main__":
    process()
