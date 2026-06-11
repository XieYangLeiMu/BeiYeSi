"""Vercel serverless 函数入口 —— 导入 FastAPI app"""
import sys
import os

# 将项目根目录加入 sys.path，确保 backend 模块可导入
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app
