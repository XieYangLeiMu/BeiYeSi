"""Pair Plot 分析模块 — 散点图矩阵相关矩阵与变量统计"""

from typing import Any

import numpy as np

from models import Experiment


def _extract_numeric_variables(experiments: list[Experiment]) -> tuple[list[str], np.ndarray]:
    """
    从实验列表中提取所有数值型变量，返回 (变量名列表, N×M 数据矩阵)
    其中 N = 实验数, M = 数值变量数
    """
    if not experiments:
        return [], np.array([])

    # 找到所有数值变量名（取第一个实验中有数值型 value 的 key）
    first = experiments[0]
    numeric_names = [
        k for k, v in first.variables.items()
        if isinstance(v, (int, float))
    ]

    if not numeric_names:
        return [], np.array([])

    # 构建数据矩阵
    data = np.zeros((len(experiments), len(numeric_names)))
    for i, exp in enumerate(experiments):
        for j, name in enumerate(numeric_names):
            val = exp.variables.get(name, 0)
            if isinstance(val, (int, float)):
                data[i, j] = float(val)
            else:
                data[i, j] = 0.0  # 兜底

    return numeric_names, data


def compute_correlation_matrix(
    experiments: list[Experiment],
) -> dict[str, dict[str, float]]:
    """
    计算数值变量之间的 Pearson 相关系数矩阵

    返回格式: {featureA: {featureB: value, ...}, ...}
    """
    names, data = _extract_numeric_variables(experiments)

    if len(names) < 2 or data.shape[0] < 2:
        return {} if not names else {n: {n: 1.0} for n in names}

    # numpy.corrcoef 按行计算，需要转置
    corr = np.corrcoef(data.T)

    # 处理 NaN（常量列会导致除零）
    corr = np.nan_to_num(corr, nan=0.0)

    result: dict[str, dict[str, float]] = {}
    for i, a_name in enumerate(names):
        result[a_name] = {}
        for j, b_name in enumerate(names):
            result[a_name][b_name] = float(round(corr[i, j], 4))

    return result


def compute_variable_stats(
    experiments: list[Experiment],
) -> list[dict[str, Any]]:
    """
    计算每个数值变量的统计量：name, min, max, mean, std, cv (变异系数)

    cv = std / mean（仅当 mean ≠ 0 时计算）
    """
    names, data = _extract_numeric_variables(experiments)

    if len(names) == 0 or data.shape[0] == 0:
        return []

    stats = []
    for j, name in enumerate(names):
        col = data[:, j]
        mean_val = float(np.mean(col))
        std_val = float(np.std(col, ddof=0))
        cv_val = round(std_val / mean_val, 4) if abs(mean_val) > 1e-12 else 0.0

        stats.append({
            "name": name,
            "min": float(round(np.min(col), 4)),
            "max": float(round(np.max(col), 4)),
            "mean": float(round(mean_val, 4)),
            "std": float(round(std_val, 4)),
            "cv": cv_val,
        })

    return stats


def analyze(experiments: list[Experiment]) -> dict[str, Any]:
    """
    综合分析入口：返回 pair plot 所需的所有数据
    """
    names, _ = _extract_numeric_variables(experiments)

    return {
        "correlationMatrix": compute_correlation_matrix(experiments),
        "variableStats": compute_variable_stats(experiments),
        "featureNames": names,
    }
