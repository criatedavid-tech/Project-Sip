# Whisper local

Serviço privado de transcrição pós-chamada com `faster-whisper`. O worker envia
o WAV por HTTP local e persiste o texto e os segmentos no PostgreSQL. O áudio
não sai da máquina.

## Executar

```powershell
docker compose --env-file .env -f infra/docker-compose.yml up -d --build whisper
docker compose --env-file .env -f infra/docker-compose.yml logs -f whisper
```

O primeiro áudio baixa o modelo para o volume `whisper_models`; as próximas
transcrições reutilizam o cache. O endpoint fica limitado a
`http://127.0.0.1:8090` no ambiente local.

Para esta máquina, os valores recomendados são `small`, `cpu` e `int8`. Em uma
VPS com GPU NVIDIA, altere o dispositivo e o tipo de computação somente depois
de instalar uma imagem compatível com CUDA/cuDNN.
