"""贝叶斯优化工具 - FastAPI 后端主入口（PostgreSQL 持久化 + 审计日志）"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db, init_db
from db_models import UserModel, ExperimentModel, AuditLogModel, ProjectModel
from models import (
    Experiment, LHSGenerateRequest, BOSuggestRequest,
    ExperimentUpdateRequest, BOSuggestResponse, SurfaceDataResponse,
    SHAPValuesResponse, Objective, BOSettings,
    BOBatchSuggestRequest, PartialDependenceRequest,
    User, UserRegisterRequest, UserLoginRequest, TokenResponse,
    UploadPreviewResponse, UploadColumn,
    AuditLogEntry, AuditLogResponse,
    ProjectState, ProjectResponse, ProjectCreateRequest, ProjectUpdateRequest,
    PairPlotRequest, PairPlotResponse,
)
from pairplot import analyze as pairplot_analyze
from lhs import generate_lhs_samples
from bayesian_opt import suggest_next_experiment, generate_response_surface, generate_candidate_pool, batch_suggest
from shap_analysis import compute_shap_values, compute_shap_beeswarm, compute_partial_dependence
from auth import (
    hash_password, verify_password, create_access_token, get_current_user_id,
)
from audit import create_audit_log, get_audit_logs


# ---- 应用启动 ----

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化数据库"""
    init_db()
    # 种子默认管理员账户
    db = next(get_db())
    try:
        existing = db.query(UserModel).filter(UserModel.username == "admin").first()
        if not existing:
            admin = UserModel(
                username="admin",
                hashed_password=hash_password("admin123"),
                created_at=datetime.now(timezone.utc),
            )
            db.add(admin)
            db.commit()
            print("[init] 默认管理员账户已创建: admin / admin123")
    finally:
        db.close()
    yield


app = FastAPI(
    title="贝叶斯优化工具 API",
    description="Bayesian Optimization backend for intelligent experiment design",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


# ---- 工具函数 ----

def get_client_info(request: Request) -> tuple[Optional[str], Optional[str]]:
    ip = request.client.host if request.client else None
    ua = request.headers.get("User-Agent")
    return ip, ua


def _db_save_experiment(db: Session, exp_data: Experiment) -> ExperimentModel:
    """将 Pydantic Experiment 保存或更新到数据库"""
    if exp_data.id > 0:
        existing = db.query(ExperimentModel).filter(ExperimentModel.id == exp_data.id).first()
        if existing:
            existing.batch = exp_data.batch
            existing.variables = exp_data.variables
            existing.objectives = exp_data.objectives
            existing.source = exp_data.source
            existing.status = exp_data.status
            if exp_data.timestamp:
                existing.timestamp = datetime.fromisoformat(exp_data.timestamp.replace("Z", "+00:00"))
            existing.updated_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(existing)
            return existing
    db_exp = ExperimentModel(
        batch=exp_data.batch,
        variables=exp_data.variables,
        objectives=exp_data.objectives,
        source=exp_data.source,
        status=exp_data.status,
        timestamp=datetime.fromisoformat(exp_data.timestamp.replace("Z", "+00:00"))
        if exp_data.timestamp else datetime.now(timezone.utc),
    )
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)
    return db_exp


def _get_all_experiments(db: Session) -> list[Experiment]:
    return [em.to_pydantic() for em in db.query(ExperimentModel).all()]


# ---- 认证依赖 ----

def get_current_user(
    authorization: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    token = authorization.credentials if authorization else None
    if not token:
        return None
    user_id = get_current_user_id(token)
    if user_id is None:
        return None
    db_user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if db_user is None:
        return None
    return db_user.to_pydantic()


def require_current_user(
    authorization: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if authorization is None:
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    token = authorization.credentials
    user_id = get_current_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="无效或过期的令牌")
    db_user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return db_user.to_pydantic()


# ---- API 路由 ----

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "bayesian-optimization-tool"}


# ---- 认证 ----

@app.get("/api/auth/me")
async def auth_me(current_user: User = Depends(require_current_user)):
    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "username": current_user.username,
            "created_at": current_user.created_at,
        },
    }


@app.post("/api/auth/register")
async def auth_register(request: UserRegisterRequest, req: Request, db: Session = Depends(get_db)):
    existing = db.query(UserModel).filter(UserModel.username == request.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    db_user = UserModel(
        username=request.username,
        hashed_password=hash_password(request.password),
        created_at=datetime.now(timezone.utc),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    ip, ua = get_client_info(req)
    create_audit_log(
        db, user_id=db_user.id, username=db_user.username,
        action="register", resource_type="user", resource_id=str(db_user.id),
        ip_address=ip, user_agent=ua,
    )

    token = create_access_token({"sub": str(db_user.id), "username": db_user.username})
    return {
        "success": True,
        "data": TokenResponse(
            access_token=token, username=db_user.username, user_id=db_user.id,
        ).model_dump(),
    }


@app.post("/api/auth/login")
async def auth_login(request: UserLoginRequest, req: Request, db: Session = Depends(get_db)):
    db_user = db.query(UserModel).filter(UserModel.username == request.username).first()
    if db_user is None or not verify_password(request.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    ip, ua = get_client_info(req)
    create_audit_log(
        db, user_id=db_user.id, username=db_user.username,
        action="login", resource_type="user", resource_id=str(db_user.id),
        ip_address=ip, user_agent=ua,
    )

    token = create_access_token({"sub": str(db_user.id), "username": db_user.username})
    return {
        "success": True,
        "data": TokenResponse(
            access_token=token, username=db_user.username, user_id=db_user.id,
        ).model_dump(),
    }


# ---- LHS 实验设计 ----

@app.post("/api/lhs/generate")
async def lhs_generate(
    request: LHSGenerateRequest,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    try:
        experiments = generate_lhs_samples(request)
        db_exps: list[ExperimentModel] = []
        for exp in experiments:
            db_exp = ExperimentModel(
                batch=exp.batch,
                variables=exp.variables,
                objectives=exp.objectives,
                source=exp.source,
                status=exp.status,
                timestamp=datetime.fromisoformat(exp.timestamp.replace("Z", "+00:00"))
                if exp.timestamp else datetime.now(timezone.utc),
                created_by=current_user.id if current_user else None,
            )
            db.add(db_exp)
            db_exps.append(db_exp)
        db.commit()
        for e in db_exps:
            db.refresh(e)

        ip, ua = get_client_info(req)
        username = current_user.username if current_user else "anonymous"
        create_audit_log(
            db, user_id=current_user.id if current_user else None, username=username,
            action="lhs_generate", resource_type="lhs",
            detail={"num_samples": len(experiments), "var_count": len(request.continuousVars) + len(request.categoricalVars) + len(request.discreteVars)},
            ip_address=ip, user_agent=ua,
        )

        result = [e.to_pydantic().model_dump() for e in db_exps]
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LHS 生成失败: {str(e)}")


# ---- BO 贝叶斯优化 ----

@app.post("/api/bo/suggest")
async def bo_suggest(
    request: BOSuggestRequest,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    try:
        for exp in request.experiments:
            orm_exp = _db_save_experiment(db, exp)
            if current_user and orm_exp.created_by is None:
                orm_exp.created_by = current_user.id
                db.commit()

        suggestion = suggest_next_experiment(request)

        ip, ua = get_client_info(req)
        username = current_user.username if current_user else "anonymous"
        create_audit_log(
            db, user_id=current_user.id if current_user else None, username=username,
            action="bo_suggest", resource_type="bo",
            detail={"acquisition": request.settings.acquisition, "kernel": request.settings.kernel},
            ip_address=ip, user_agent=ua,
        )

        return {"success": True, "data": suggestion.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BO 优化失败: {str(e)}")


@app.post("/api/bo/surface")
async def bo_surface(request: BOSuggestRequest):
    try:
        surface = generate_response_surface(request)
        return {"success": True, "data": surface.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"响应面生成失败: {str(e)}")


@app.post("/api/bo/candidates")
async def bo_candidates(request: BOSuggestRequest):
    try:
        pool = generate_candidate_pool(request)
        return {"success": True, "data": pool.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"候选池生成失败: {str(e)}")


@app.post("/api/bo/batch-suggest")
async def bo_batch_suggest(
    request: BOBatchSuggestRequest,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    try:
        for exp in request.experiments:
            _db_save_experiment(db, exp)

        suggestions = batch_suggest(request)

        ip, ua = get_client_info(req)
        username = current_user.username if current_user else "anonymous"
        create_audit_log(
            db, user_id=current_user.id if current_user else None, username=username,
            action="bo_batch_suggest", resource_type="bo",
            detail={"batch_size": request.nCandidates, "acquisition": request.settings.acquisition},
            ip_address=ip, user_agent=ua,
        )

        return {"success": True, "data": [s.model_dump() for s in suggestions]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"批量采样失败: {str(e)}")


# ---- 项目管理 ----

@app.post("/api/projects")
async def create_project(
    request: ProjectCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_current_user),
):
    model = ProjectModel(
        name=request.name,
        description=request.description,
        user_id=current_user.id,
        state={},
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    resp = model.to_response(ProjectState())
    return {"success": True, "data": resp.model_dump()}


@app.get("/api/projects")
async def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_current_user),
):
    projects = (
        db.query(ProjectModel)
        .filter(ProjectModel.user_id == current_user.id)
        .order_by(ProjectModel.updated_at.desc())
        .all()
    )
    return {
        "success": True,
        "data": [p.to_response(ProjectState(**p.state)).model_dump() for p in projects],
    }


@app.get("/api/projects/{project_id}")
async def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_current_user),
):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {
        "success": True,
        "data": project.to_response(ProjectState(**project.state)).model_dump(),
    }


@app.put("/api/projects/{project_id}")
async def update_project(
    project_id: int,
    request: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_current_user),
):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if request.name is not None:
        project.name = request.name
    if request.description is not None:
        project.description = request.description
    if request.state is not None:
        project.state = request.state.model_dump()
    db.commit()
    db.refresh(project)
    return {
        "success": True,
        "data": project.to_response(ProjectState(**project.state)).model_dump(),
    }


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_current_user),
):
    project = db.query(ProjectModel).filter(
        ProjectModel.id == project_id,
        ProjectModel.user_id == current_user.id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    db.delete(project)
    db.commit()
    return {"success": True}


# ---- 实验数据管理 ----

@app.get("/api/experiments")
async def get_experiments(db: Session = Depends(get_db)):
    experiments = _get_all_experiments(db)
    return {"success": True, "data": [e.model_dump() for e in experiments]}


@app.get("/api/experiments/{experiment_id}")
async def get_experiment(experiment_id: int, db: Session = Depends(get_db)):
    db_exp = db.query(ExperimentModel).filter(ExperimentModel.id == experiment_id).first()
    if not db_exp:
        raise HTTPException(status_code=404, detail="实验不存在")
    return {"success": True, "data": db_exp.to_pydantic().model_dump()}


@app.put("/api/experiments/{experiment_id}")
async def update_experiment(
    experiment_id: int,
    request: ExperimentUpdateRequest,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    db_exp = db.query(ExperimentModel).filter(ExperimentModel.id == experiment_id).first()
    if not db_exp:
        raise HTTPException(status_code=404, detail="实验不存在")

    db_exp.objectives = request.objectives
    db_exp.status = "completed"
    db_exp.timestamp = datetime.now(timezone.utc)
    db_exp.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(db_exp)

    ip, ua = get_client_info(req)
    username = current_user.username if current_user else "anonymous"
    create_audit_log(
        db, user_id=current_user.id if current_user else None, username=username,
        action="experiment_update", resource_type="experiment", resource_id=str(experiment_id),
        ip_address=ip, user_agent=ua,
    )

    return {"success": True, "data": db_exp.to_pydantic().model_dump()}


@app.delete("/api/experiments/{experiment_id}")
async def delete_experiment(
    experiment_id: int,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    db_exp = db.query(ExperimentModel).filter(ExperimentModel.id == experiment_id).first()
    if not db_exp:
        raise HTTPException(status_code=404, detail="实验不存在")

    db.delete(db_exp)

    ip, ua = get_client_info(req)
    username = current_user.username if current_user else "anonymous"
    create_audit_log(
        db, user_id=current_user.id if current_user else None, username=username,
        action="experiment_delete", resource_type="experiment", resource_id=str(experiment_id),
        ip_address=ip, user_agent=ua,
    )

    db.commit()
    return {"success": True}


# ---- 数据上传与分析 ----

@app.post("/api/data/upload", response_model=dict)
async def data_upload(file: UploadFile = File(...)):
    import openpyxl
    from io import BytesIO

    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 或 .xls 文件")

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        sheet_name = ws.title

        rows_iter = list(ws.iter_rows(values_only=True))
        if len(rows_iter) < 2:
            raise HTTPException(status_code=400, detail="数据不足：至少需要表头 + 1 行数据")

        headers = [str(c) if c is not None else f'列{i}' for i, c in enumerate(rows_iter[0])]
        data_rows = []
        for row in rows_iter[1:]:
            row_data = {}
            for i, val in enumerate(row):
                if i < len(headers):
                    row_data[headers[i]] = val
            data_rows.append(row_data)

        total_rows = len(data_rows)
        total_cols = len(headers)

        columns_info = []
        for i, h in enumerate(headers):
            col_vals = [r.get(h) for r in data_rows if r.get(h) is not None]
            clean_vals = [v for v in col_vals if v != '' and v is not None]
            missing = total_rows - len(clean_vals)

            numeric_count = 0
            str_count = 0
            int_count = 0
            for v in clean_vals:
                if isinstance(v, (int, float)):
                    numeric_count += 1
                    if isinstance(v, int) or (isinstance(v, float) and v == int(v)):
                        int_count += 1
                elif isinstance(v, str):
                    str_count += 1

            uniq = len(set(str(v) for v in clean_vals))

            col_info: UploadColumn = UploadColumn(
                name=h, type='continuous', count=len(clean_vals),
                unique=uniq, missing=missing,
            )

            if str_count > numeric_count:
                col_info.type = 'categorical'
                col_info.options = sorted(set(str(v) for v in clean_vals))
            elif numeric_count > 0:
                nums = [float(v) for v in clean_vals if isinstance(v, (int, float))]
                col_info.min = round(min(nums), 6) if nums else None
                col_info.max = round(max(nums), 6) if nums else None
                if int_count == numeric_count and uniq <= 20:
                    col_info.type = 'discrete'
                else:
                    col_info.type = 'continuous'
            else:
                col_info.type = 'categorical'
                col_info.options = sorted(set(str(v) for v in clean_vals))

            columns_info.append(col_info)

        wb.close()

        preview_rows = [
            {h: row.get(h) for h in headers}
            for row in data_rows[:200]
        ]

        return {
            "success": True,
            "data": UploadPreviewResponse(
                columns=columns_info,
                rows=preview_rows,
                totalRows=total_rows,
                totalCols=total_cols,
                sheetName=sheet_name,
            ).model_dump(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")


@app.post("/api/data/import")
async def data_import(
    request: dict,
    req: Request,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    try:
        rows = request.get('rows', [])
        var_names = request.get('varNames', [])
        obj_names = request.get('objNames', [])

        if not rows:
            raise HTTPException(status_code=400, detail="没有数据可导入")

        imported: list[ExperimentModel] = []
        for i, row in enumerate(rows):
            variables = {}
            for vn in var_names:
                if vn in row:
                    val = row[vn]
                    if isinstance(val, str):
                        variables[vn] = val
                    elif val is not None:
                        variables[vn] = float(val)

            objectives = {}
            for on in obj_names:
                if on in row and row[on] is not None:
                    try:
                        objectives[on] = float(row[on])
                    except (ValueError, TypeError):
                        pass

            db_exp = ExperimentModel(
                batch=i + 1,
                variables=variables,
                objectives=objectives,
                source='Manual',
                status='completed' if objectives else 'pending',
                timestamp=datetime.now(timezone.utc),
                created_by=current_user.id if current_user else None,
            )
            db.add(db_exp)
            imported.append(db_exp)

        db.commit()
        for e in imported:
            db.refresh(e)

        ip, ua = get_client_info(req)
        username = current_user.username if current_user else "anonymous"
        create_audit_log(
            db, user_id=current_user.id if current_user else None, username=username,
            action="data_import", resource_type="data",
            detail={"count": len(imported), "var_names": var_names, "obj_names": obj_names},
            ip_address=ip, user_agent=ua,
        )

        return {
            "success": True,
            "data": [e.to_pydantic().model_dump() for e in imported],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


# ---- SHAP 分析 ----

@app.get("/api/shap/analyze/{experiment_id}")
async def shap_analyze(experiment_id: int, db: Session = Depends(get_db)):
    try:
        experiments = _get_all_experiments(db)
        shap_data = compute_shap_values(experiments, experiment_id)
        return {"success": True, "data": shap_data.model_dump()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SHAP 分析失败: {str(e)}")


@app.get("/api/shap/beeswarm")
async def shap_beeswarm(db: Session = Depends(get_db)):
    try:
        experiments = _get_all_experiments(db)
        shap_data = compute_shap_beeswarm(experiments)
        return {"success": True, "data": shap_data.model_dump()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SHAP 分析失败: {str(e)}")


@app.post("/api/shap/dependence")
async def shap_dependence(request: "PartialDependenceRequest"):
    try:
        experiments = request.experiments  # 使用请求中携带的实验数据
        dep_data = compute_partial_dependence(
            experiments,
            feature_name=request.featureName,
            color_feature=request.colorFeature,
        )
        return {"success": True, "data": dep_data.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"偏依赖分析失败: {str(e)}")


# ---- Pair Plot 分析 ----

@app.post("/api/pairplot/analyze")
async def pairplot_analyze_endpoint(request: PairPlotRequest):
    try:
        result = pairplot_analyze(request.experiments)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pair Plot 分析失败: {str(e)}")


# ---- 审计日志查询 ----

@app.get("/api/audit-logs")
async def get_audit_logs_endpoint(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    logs = get_audit_logs(db, limit=limit, offset=offset, user_id=current_user.id)
    total = db.query(AuditLogModel).filter(AuditLogModel.user_id == current_user.id).count()
    return {
        "success": True,
        "data": {
            "logs": [
                AuditLogEntry(
                    id=log.id,
                    user_id=log.user_id,
                    username=log.username,
                    action=log.action,
                    resource_type=log.resource_type,
                    resource_id=log.resource_id,
                    ip_address=log.ip_address,
                    user_agent=log.user_agent,
                    detail=log.detail or {},
                    created_at=log.created_at.isoformat() if log.created_at else "",
                ).model_dump()
                for log in logs
            ],
            "total": total,
        },
    }


# ---- 生产模式：提供前端静态文件 ----

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """生产模式下，为所有非 API 路径返回前端页面"""
    # API 路径交由 FastAPI 路由处理，此处只做兜底 404
    if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi"):
        raise HTTPException(status_code=404, detail="Not found")

    # 如果 static 目录不存在，提示用户构建前端
    if not os.path.isdir(STATIC_DIR):
        return JSONResponse(
            status_code=200,
            content={
                "message": "后端运行正常",
                "frontend": "未构建前端文件，请先运行 npm run build，或使用 npm run dev 开发模式",
                "api_docs": "/docs",
            },
        )

    file_path = os.path.join(STATIC_DIR, full_path) if full_path else STATIC_DIR
    if full_path and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    print(f"Server running at http://localhost:{port}")
    print(f"API docs: http://localhost:{port}/docs")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
