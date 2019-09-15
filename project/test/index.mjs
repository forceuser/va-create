import test from "tape";
import sinon from "sinon";
import main from "{{project_name}}";

test("empty test", t => {
	t.equal(main(), "result");
	t.end();
});
