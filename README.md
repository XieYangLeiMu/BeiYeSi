# EDBO SHAP Lab - 实验设计贝叶斯优化平台

基于贝叶斯优化的智能实验设计工具，支持 LHS 初始采样、BO 迭代优化、SHAP 可解释性分析。

## 技术栈

- **前端**: React 18 + TypeScript + Vite + Ant Design + Plotly.js
- **后端**: Python FastAPI + SQLAlchemy + scikit-optimize + SHAP
- **数据库**: PostgreSQL（生产）/ SQLite（本地开发）

## 本地开发

### 前端

```bash
npm install
npm run dev          # 启动在 http://localhost:3000
```

### 后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py               # 启动在 http://localhost:8001
```

默认管理员账户: `admin` / `admin123`

## 部署到 Vercel

### 1. 准备数据库

Vercel 不支持 SQLite。需要先准备一个 PostgreSQL 数据库：

- [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)
- [Neon](https://neon.tech/)（免费 tier）
- [Supabase](https://supabase.com/)

创建数据库后获取连接字符串，格式:
```
postgresql://user:password@host:5432/dbname
```

### 2. 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/你的用户名/你的仓库名)

或手动部署：

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

### 3. 设置环境变量

在 Vercel 项目 Settings → Environment Variables 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DATABASE_URL` | `postgresql://...` | PostgreSQL 连接字符串 |
| `JWT_SECRET_KEY` | `随机字符串` | JWT 签名密钥 |

### 4. 触发重新部署

设置环境变量后，在 Vercel Dashboard 中重新部署一次项目使环境变量生效。

## 项目结构

```
├── api/
│   └── index.py           # Vercel serverless 入口
├── backend/
│   ├── main.py            # FastAPI 主应用
│   ├── auth.py            # JWT 认证
│   ├── database.py        # 数据库连接
│   ├── db_models.py       # ORM 模型
│   ├── models.py          # Pydantic 模型
│   ├── bayesian_opt.py    # 贝叶斯优化核心
│   ├── lhs.py             # 拉丁超立方采样
│   ├── shap_analysis.py   # SHAP 可解释性
│   ├── pairplot.py        # 配对图分析
│   ├── audit.py           # 审计日志
│   └── static/            # 前端构建输出
├── src/                   # React 前端源码
├── vercel.json            # Vercel 部署配置
├── requirements.txt       # Python 依赖
└── package.json           # Node 依赖
```
