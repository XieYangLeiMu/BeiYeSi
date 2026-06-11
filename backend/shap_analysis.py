"""SHAP 可解释性分析 - 特征重要性可视化"""

import random
from typing import Optional
import numpy as np
from sklearn.ensemble import RandomForestRegressor

from models import Experiment, SHAPValuesResponse, PartialDependenceResponse


def _extract_features_for_shap(experiments: list[Experiment]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    从实验列表中提取特征矩阵和标签，用于 SHAP 分析
    """
    completed = [e for e in experiments if e.status == 'completed']
    if not completed:
        raise ValueError('没有已完成的实验数据')

    # 收集特征名称和类型
    feature_names: list[str] = []
    categorical_map: dict[str, list[str]] = {}

    for exp in completed:
        for vname in exp.variables:
            if vname not in feature_names:
                feature_names.append(vname)
                if isinstance(exp.variables[vname], str):
                    categorical_map[vname] = []

    for exp in experiments:
        for vname, vval in exp.variables.items():
            if vname in categorical_map and isinstance(vval, str) and vval not in categorical_map[vname]:
                categorical_map[vname].append(vval)

    n = len(completed)
    m = len(feature_names)
    X = np.zeros((n, m))

    for i, exp in enumerate(completed):
        for j, vname in enumerate(feature_names):
            val = exp.variables.get(vname)
            if val is None:
                X[i, j] = 0.0
            elif isinstance(val, str):
                opts = categorical_map.get(vname, [])
                X[i, j] = float(opts.index(val)) if val in opts else 0.0
            else:
                X[i, j] = float(val)

    # 取第一个目标的标签 - 处理可能为 None 的情况
    y = np.zeros(n)
    for i, exp in enumerate(completed):
        if exp.objectives:
            first_key = list(exp.objectives.keys())[0]
            y[i] = exp.objectives.get(first_key) or 0.0
        else:
            y[i] = 0.0

    return X, y, feature_names


def compute_shap_values(experiments: list[Experiment], experiment_id: int) -> SHAPValuesResponse:
    """
    使用 Random Forest + SHAP 进行特征重要性分析
    """
    X, y, feature_names = _extract_features_for_shap(experiments)

    if X.shape[0] < 5:
        return SHAPValuesResponse(
            featureNames=feature_names,
            shapValues=[0.0] * len(feature_names),
            featureValues=[0.0] * len(feature_names),
            baseValue=float(y.mean()),
            outputValue=float(y.mean()),
        )

    try:
        import shap
    except ImportError:
        # SHAP 不可用时的回退
        return _fallback_shap(X, y, feature_names, experiment_id, experiments)

    # 训练 Random Forest 模型
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X, y)

    # 计算 SHAP 值
    explainer = shap.TreeExplainer(rf)
    shap_values = explainer.shap_values(X)

    # 确保 shap_values 是二维的
    if len(shap_values.shape) == 3:
        shap_values = shap_values[:, :, 0]

    # 取指定实验或最后一个
    exp_idx = min(experiment_id - 1, X.shape[0] - 1)
    exp_idx = max(0, exp_idx)

    return SHAPValuesResponse(
        featureNames=feature_names,
        shapValues=shap_values[exp_idx].tolist(),
        featureValues=X[exp_idx].tolist(),
        baseValue=float(explainer.expected_value if np.isscalar(explainer.expected_value) else explainer.expected_value[0]),
        outputValue=float(y[exp_idx]),
    )


def compute_shap_beeswarm(experiments: list[Experiment]) -> SHAPValuesResponse:
    """
    返回 SHAP 蜂群图数据（所有实验的平均 SHAP 值）
    """
    X, y, feature_names = _extract_features_for_shap(experiments)

    if X.shape[0] < 5:
        return SHAPValuesResponse(
            featureNames=feature_names,
            shapValues=[0.0] * len(feature_names),
            featureValues=X.mean(axis=0).tolist(),
            baseValue=float(y.mean()),
            outputValue=float(y.mean()),
        )

    try:
        import shap
    except ImportError:
        return _fallback_shap(X, y, feature_names, 0, experiments)

    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X, y)

    explainer = shap.TreeExplainer(rf)
    shap_values = explainer.shap_values(X)

    if len(shap_values.shape) == 3:
        shap_values = shap_values[:, :, 0]

    # 平均绝对 SHAP 值作为特征重要性
    mean_shap = np.abs(shap_values).mean(axis=0)
    mean_features = X.mean(axis=0)

    base_val = float(explainer.expected_value if np.isscalar(explainer.expected_value) else explainer.expected_value[0])

    return SHAPValuesResponse(
        featureNames=feature_names,
        shapValues=mean_shap.tolist(),
        featureValues=mean_features.tolist(),
        baseValue=base_val,
        outputValue=float(y.mean()),
    )


def _fallback_shap(
    X: np.ndarray, y: np.ndarray, feature_names: list[str],
    experiment_id: int, experiments: list[Experiment]
) -> SHAPValuesResponse:
    """SHAP 库不可用时的回退实现"""
    n_features = len(feature_names)

    # 使用随机森林的特征重要性
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X, y)

    importances = rf.feature_importances_
    base_value = float(y.mean())

    exp_idx = min(experiment_id - 1, X.shape[0] - 1)
    exp_idx = max(0, exp_idx)

    return SHAPValuesResponse(
        featureNames=feature_names,
        shapValues=importances.tolist(),
        featureValues=X[exp_idx].tolist(),
        baseValue=base_value,
        outputValue=float(y[exp_idx]),
    )


def compute_partial_dependence(
    experiments: list[Experiment],
    feature_name: str,
    color_feature: Optional[str] = None,
) -> PartialDependenceResponse:
    """
    计算某个变量对目标输出的偏依赖图数据
    """
    X, y, feature_names = _extract_features_for_shap(experiments)

    if X.shape[0] < 5:
        return PartialDependenceResponse(
            featureName=feature_name,
            xValues=[],
            yValues=[],
        )

    try:
        import shap
    except ImportError:
        pass

    # 确定特征索引
    if feature_name not in feature_names:
        return PartialDependenceResponse(featureName=feature_name, xValues=[], yValues=[])

    feat_idx = feature_names.index(feature_name)

    # 训练 RF 模型
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X, y)

    # 构建特征值的均匀网格
    x_min, x_max = float(X[:, feat_idx].min()), float(X[:, feat_idx].max())
    x_range = np.linspace(x_min - 0.1 * (x_max - x_min), x_max + 0.1 * (x_max - x_min), 50)

    # 对每个网格点，用所有样本的平均预测值
    y_vals = []
    lower_bound = []
    upper_bound = []

    X_mean = X.mean(axis=0, keepdims=True)

    for x_val in x_range:
        X_test = np.tile(X_mean, (len(X), 1))
        X_test[:, feat_idx] = X[:, feat_idx]  # 保持原始特征值
        X_test[:, feat_idx] = x_val  # 替换为网格值

        if hasattr(rf, 'estimators_'):
            tree_preds = np.array([tree.predict(X_test) for tree in rf.estimators_])
            pred_mean = tree_preds.mean(axis=0).mean()
            pred_std = tree_preds.std(axis=0).mean()
        else:
            pred_mean = rf.predict(X_test).mean()
            pred_std = 0.0

        y_vals.append(float(pred_mean))
        lower_bound.append(float(pred_mean - 1.96 * pred_std))
        upper_bound.append(float(pred_mean + 1.96 * pred_std))

    return PartialDependenceResponse(
        featureName=feature_name,
        xValues=[float(v) for v in x_range],
        yValues=y_vals,
        lowerBound=lower_bound,
        upperBound=upper_bound,
    )
