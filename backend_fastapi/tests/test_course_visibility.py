import uuid

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


instructor_email = f"instructor_{uuid.uuid4().hex[:8]}@example.com"
instructor = client.post(
    "/api/auth/sign-up",
    json={
        "email": instructor_email,
        "password": "pass1234",
        "full_name": "Visibility Instructor",
        "role": "instructor",
    },
)
assert instructor.status_code == 201, instructor.text
instructor_user = instructor.json()["data"]["user"]

student_email = f"student_{uuid.uuid4().hex[:8]}@example.com"
student = client.post(
    "/api/auth/sign-up",
    json={
        "email": student_email,
        "password": "pass1234",
        "full_name": "Visibility Student",
        "role": "student",
    },
)
assert student.status_code == 201, student.text
student_id = student.json()["data"]["user"]["id"]

course_payload = {
    "instructor_id": instructor_user["id"],
    "title": "Visibility Check Course",
    "description": "Should be visible to students and admins.",
    "status": "published",
    "is_published": True,
    "modules": [
        {
            "title": "Module 1",
            "lessons": [
                {
                    "title": "Lesson 1",
                    "video_url": "https://example.com/video.mp4",
                    "content": "Lesson content",
                }
            ],
        }
    ],
}
created = client.post(
    "/api/courses",
    json=course_payload,
    headers={"Authorization": f"Bearer {instructor_user['id']}"},
)
assert created.status_code == 201, created.text
created_course = created.json()["data"]
assert created_course["is_published"] is True, created

public_courses = client.get("/api/courses")
assert public_courses.status_code == 200, public_courses.text
public_items = public_courses.json()["data"]
public_ids = {item["id"] for item in public_items}
assert created_course["id"] in public_ids, public_courses.json()

student_courses = client.get(
    "/api/courses",
    headers={"Authorization": f"Bearer {student_id}"},
)
assert student_courses.status_code == 200, student_courses.text
student_ids = {item["id"] for item in student_courses.json()["data"]}
assert created_course["id"] in student_ids, student_courses.json()

admin_courses = client.get(
    "/api/courses",
    headers={"Authorization": "Bearer admin-1"},
)
assert admin_courses.status_code == 200, admin_courses.text
admin_ids = {item["id"] for item in admin_courses.json()["data"]}
assert created_course["id"] in admin_ids, admin_courses.json()

print("visibility_ok", {
    "public_count": len(public_items),
    "student_count": len(student_courses.json()["data"]),
    "admin_count": len(admin_courses.json()["data"]),
    "course_id": created_course["id"],
})
