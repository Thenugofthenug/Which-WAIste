FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production OMP_NUM_THREADS=2
# CPU-only PyTorch avoids downloading CUDA libraries on a CPU web service.
RUN pip install --no-cache-dir 'torch>=2.6,<3' --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY file_consolidation/ ./file_consolidation/
COPY --from=frontend /app/frontend/dist ./frontend/dist
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log"]
