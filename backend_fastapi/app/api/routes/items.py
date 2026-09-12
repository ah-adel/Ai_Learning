from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()


class ItemCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, strict=True)

    name: str = Field(..., min_length=2, max_length=100)
    price: float = Field(..., gt=0)
    in_stock: bool = True
    category: Annotated[str, Field(min_length=2, max_length=50)]


class ItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: float
    in_stock: bool
    category: str


ITEMS: dict[int, ItemResponse] = {}


@router.get("/items", response_model=list[ItemResponse], status_code=status.HTTP_200_OK)
async def list_items() -> list[ItemResponse]:
    return list(ITEMS.values())


@router.get("/items/{item_id}", response_model=ItemResponse)
async def get_item(item_id: int) -> ItemResponse:
    item = ITEMS.get(item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item


@router.post("/items", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(payload: ItemCreate) -> ItemResponse:
    item_id = len(ITEMS) + 1
    item = ItemResponse(
        id=item_id,
        name=payload.name,
        price=payload.price,
        in_stock=payload.in_stock,
        category=payload.category,
    )
    ITEMS[item_id] = item
    return item


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int) -> None:
    if item_id not in ITEMS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    del ITEMS[item_id]
    return None


@router.get("/search")
async def search_items(
    q: Annotated[str, Query(min_length=1, max_length=50)] = "",
) -> dict[str, list[str]]:
    results = [item.name for item in ITEMS.values() if q.lower() in item.name.lower()]
    return {"results": results}
