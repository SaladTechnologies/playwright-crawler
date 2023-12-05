FROM pytorch/pytorch:2.1.1-cuda12.1-cudnn8-runtime

# upgrade pip
RUN pip install --upgrade pip

# Create app directory
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

RUN playwright install --with-deps chromium

COPY app/ .

CMD [ "python", "app.py" ]