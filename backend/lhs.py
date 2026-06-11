"""拉丁超立方采样 (Latin Hypercube Sampling)"""

import random
from datetime import datetime, timezone

import numpy as np
from scipy.stats.qmc import LatinHypercube

from models import (
    ContinuousVariable, CategoricalVariable, DiscreteVariable,
    Constraint, Experiment, LHSGenerateRequest,
)


def _evaluate_constraint(expression: str, variables: dict[str, float | str]) -> bool:
    """评估约束表达式是否满足"""
    if not expression or expression.strip() == '':
        return True
    try:
        local_vars = {k: v for k, v in variables.items() if isinstance(v, (int, float))}
        result = eval(expression, {'__builtins__': {}}, local_vars)
        return bool(result)
    except Exception:
        return True


def _normalize(x: float, lo: float, hi: float) -> float:
    """将 [0,1] 区间映射到 [lo, hi]"""
    return lo + (hi - lo) * x


def generate_lhs_samples(request: LHSGenerateRequest) -> list[Experiment]:
    """
    生成 LHS 初始实验设计

    使用 scipy 的 LatinHypercube 为连续变量生成空间填充采样点，
    分类变量则随机均匀采样，离散变量按步长离散化。
    """
    n_vars = len(request.continuousVars) + len(request.discreteVars)
    n_samples = request.nSamples

    experiments: list[Experiment] = []

    # ---- 1. 生成连续+离散变量的 LHS 采样点 ----
    if n_vars > 0:
        sampler = LatinHypercube(d=n_vars, seed=random.randint(0, 2**31-1))
        lhs_points = sampler.random(n=n_samples)
    else:
        lhs_points = np.empty((n_samples, 0))

    # ---- 2. 构建每个样本的变量字典 ----
    for i in range(n_samples):
        variables: dict[str, float | str] = {}
        col = 0

        # 连续变量
        for cv in request.continuousVars:
            lo, hi = cv.min, cv.max
            raw = float(lhs_points[i, col])
            val = _normalize(raw, lo, hi)
            if cv.step is not None and cv.step > 0:
                val = round(val / cv.step) * cv.step
                val = max(lo, min(hi, val))
            variables[cv.name] = round(val, 6)
            col += 1

        # 离散变量
        for dv in request.discreteVars:
            raw = float(lhs_points[i, col])
            lo, hi = dv.min, dv.max
            val = _normalize(raw, lo, hi)
            val = round(val / dv.step) * dv.step
            val = max(lo, min(hi, val))
            variables[dv.name] = int(val)
            col += 1

        # 分类变量 - 随机均匀采样
        for catv in request.categoricalVars:
            variables[catv.name] = random.choice(catv.options)

        # ---- 3. 检查约束 ----
        retries = 0
        while retries < 1000:
            ok = True
            for c in request.constraints:
                if not _evaluate_constraint(c.expression, variables):
                    ok = False
                    break
            if ok:
                break
            # 重新随机生成不满足约束的变量
            for cv in request.continuousVars:
                variables[cv.name] = round(
                    cv.min + random.random() * (cv.max - cv.min), 6
                )
            for catv in request.categoricalVars:
                variables[catv.name] = random.choice(catv.options)
            retries += 1

        # ---- 4. 创建 Experiment 记录 ----
        objectives: dict[str, float | None] = {}
        for cv in request.continuousVars:
            pass  # 目标值需要实验后才能填写

        exp = Experiment(
            id=i + 1,
            batch=i + 1,
            variables=variables,
            objectives={},  # 初始无目标值
            source='LHS',
            status='pending',
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        experiments.append(exp)

    return experiments
