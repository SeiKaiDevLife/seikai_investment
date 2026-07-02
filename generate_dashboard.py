import os
import sys
import pandas as pd
import json

def get_resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def create_template():
    df = pd.DataFrame([
        {"基金代码": "012345", "持仓单价": 1.25, "持有份额": 1000.5},
        {"基金代码": "004567", "持仓单价": 0.88, "持有份额": 2000.0}
    ])
    df.to_excel("data.xlsx", index=False)
    print("已生成 data.xlsx 模板文件，请填写后再次运行。")

def main():
    if not os.path.exists("data.xlsx"):
        create_template()
        os.system("pause")
        return

    print("正在读取 data.xlsx ...")
    try:
        df = pd.read_excel("data.xlsx")
        df['基金代码'] = df['基金代码'].astype(str).str.zfill(6) # 确保6位代码
        holdings = []
        for _, row in df.iterrows():
            code = str(row['基金代码'])
            if code == 'nan' or not code: continue
            
            # 由于不强制要求基金名称，名字交由后面爬虫自动补全
            name = "" 
            
            # 读取份额
            shares = float(row.get('持有份额', 0))
            
            # 读取单价，兼容新列名"持仓单价"以及之前的容错
            cost_val = row.get('持仓单价', None)
            if pd.isna(cost_val) or cost_val is None:
                cost_val = row.get('持仓均价', None)
            if pd.isna(cost_val) or cost_val is None:
                cost_val = row.get('持仓成本', 0)
            cost_price = float(cost_val)
            
            holdings.append({
                "code": code,
                "name": name,
                "shares": shares,
                "cost_price": cost_price
            })
    except Exception as e:
        print(f"读取 data.xlsx 失败: {e}")
        os.system("pause")
        return

    print(f"成功读取 {len(holdings)} 条持仓记录，开始从天天基金获取历史数据(预计需要十几秒)...")
    
    import urllib.request
    import re

    for item in holdings:
        code = item['code']
        url = f"http://fund.eastmoney.com/pingzhongdata/{code}.js"
        
        print(f"正在获取 {code} 历史数据...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                content = response.read().decode('utf-8')
                
                name_match = re.search(r'var fS_name = "(.*?)";', content)
                item['name'] = name_match.group(1) if name_match else code
                
                trend_match = re.search(r'var Data_netWorthTrend\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['netWorthTrend'] = json.loads(trend_match.group(1)) if trend_match else []
                
                stock_match = re.search(r'var stockCodesNew\s*=\s*(\[.*?\]);', content, re.DOTALL)
                if not stock_match:
                    stock_match = re.search(r'var stockCodes\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['stockCodes'] = json.loads(stock_match.group(1)) if stock_match else []

                grand_match = re.search(r'var Data_grandTotal\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['grandTotal'] = json.loads(grand_match.group(1)) if grand_match else []

                asset_match = re.search(r'var Data_assetAllocation\s*=\s*(\{.*?\});', content, re.DOTALL)
                item['assetAllocation'] = json.loads(asset_match.group(1)) if asset_match else {}
                
                mgr_match = re.search(r'var Data_currentFundManager\s*=\s*(.*?);', content, re.DOTALL)
                if mgr_match:
                    try: item['manager'] = json.loads(mgr_match.group(1))
                    except: item['manager'] = []
                else: item['manager'] = []

                item['syl_1y'] = re.search(r'var syl_1y\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_1y\s*=\s*"([^"]*)";', content) else "--"
                item['syl_3y'] = re.search(r'var syl_3y\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_3y\s*=\s*"([^"]*)";', content) else "--"
                item['syl_1n'] = re.search(r'var syl_1n\s*=\s*"([^"]*)";', content).group(1) if re.search(r'var syl_1n\s*=\s*"([^"]*)";', content) else "--"
                
                scale_match = re.search(r'var Data_fluctuationScale\s*=\s*(\[.*?\]);', content, re.DOTALL)
                item['scale'] = json.loads(scale_match.group(1)) if scale_match else []

        except Exception as e:
            print(f"获取 {code} 历史数据失败: {e}")
            item['name'] = code
            item['netWorthTrend'] = []
            item['stockCodes'] = []

    print("历史数据获取完毕，正在生成单文件全景看板...")

    try:
        # 读取源文件
        with open(get_resource_path('index.html'), 'r', encoding='utf-8') as f:
            html = f.read()
        with open(get_resource_path('css/style.css'), 'r', encoding='utf-8') as f:
            css = f.read()
        with open(get_resource_path('js/main.js'), 'r', encoding='utf-8') as f:
            js = f.read()
        
        # 组装持仓数据
        holdings_js = f"const MY_HOLDINGS = {json.dumps(holdings, ensure_ascii=False)};"

        # 替换外链为内联
        import re
        html = re.sub(r'<link rel="stylesheet" href="css/style\.css\?v=\d+">', '<style>CSS_PLACEHOLDER</style>', html)
        html = re.sub(r'<script src="data/holdings\.js"></script>', '<script>HOLDINGS_PLACEHOLDER</script>', html)
        html = re.sub(r'<script src="js/main\.js\?v=\d+"></script>', '<script>JS_PLACEHOLDER</script>', html)

        html = html.replace('CSS_PLACEHOLDER', css)
        html = html.replace('HOLDINGS_PLACEHOLDER', holdings_js)
        error_handler = "window.onerror = function(msg, url, line, col, error) { alert('Error: ' + msg + '\\nLine: ' + line + '\\nCol: ' + col); };\n"
        html = html.replace('JS_PLACEHOLDER', error_handler + js)

        # 写入新文件
        output_name = "我的投资全景看板.html"
        with open(output_name, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"\n生成成功！请打开 {output_name} 查看。")
    except Exception as e:
        print(f"\n生成失败: {e}")
    
    os.system("pause")

if __name__ == "__main__":
    main()
